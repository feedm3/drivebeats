import { metadataEnvironmentKey } from "@/lib/drive-metadata-reader";
import { resolveKnownTrack } from "@/lib/known-track-resolver";
import { scanMetadataRecords } from "@/lib/metadata-cache-db";
import { getMetadataFreshness } from "@/lib/metadata-cache-types";
import { buildMetadataCoverage } from "@/lib/metadata-coverage";
import type { MetadataView } from "@/lib/track-metadata-loader";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import type { DriveFile } from "@/types";

/** Aggregate counts over the same persisted records; no second tag cache. */
export async function buildPersistedMetadataCoverage(
  accountId: string,
  tracks: DriveFile[],
  getState: (track: DriveFile) => MetadataView,
  signal?: AbortSignal,
) {
  const memory =
    useId3MetadataStore.getState().accountId === accountId
      ? useId3MetadataStore.getState().records
      : {};
  // Keep full-Library aggregation out of render and yield actual tasks so a
  // large warm catalog cannot starve animation, menus or pointer interactions.
  const coverage = buildMetadataCoverage([], getState);
  const environment = metadataEnvironmentKey();
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const bucketKeys = [
    "ready",
    "noTargetTags",
    "unresolved",
    "stale",
    "errors",
    "unknown",
  ] as const;
  const fieldKeys = ["title", "artist", "album"] as const;
  for (let offset = 0; offset < tracks.length; offset += 100) {
    signal?.throwIfAborted();
    const chunk = buildMetadataCoverage(
      tracks.slice(offset, offset + 100),
      getState,
    );
    for (const key of bucketKeys) coverage[key] += chunk[key];
    for (const key of fieldKeys) coverage.fields[key] += chunk.fields[key];
    for (const [reason, count] of Object.entries(chunk.unresolvedReasons))
      coverage.unresolvedReasons[reason] =
        (coverage.unresolvedReasons[reason] ?? 0) + count;
    if (offset + 100 < tracks.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  coverage.total = tracks.length;
  const durable = await scanMetadataRecords(
    accountId,
    (record) => {
      const track = byId.get(record.fileId);
      if (!track || memory[record.fileId] || record.accountId !== accountId)
        return;
      const before = buildMetadataCoverage([track], getState);
      const after = buildMetadataCoverage([track], () => ({
        status: record.status,
        freshness: getMetadataFreshness(
          record,
          resolveKnownTrack(accountId, track.id)?.track ?? track,
          environment,
        ),
        tags: record.tags,
        reason: record.reason,
      }));
      for (const key of bucketKeys) coverage[key] += after[key] - before[key];
      for (const key of fieldKeys)
        coverage.fields[key] += after.fields[key] - before.fields[key];
      for (const [reason, count] of Object.entries(before.unresolvedReasons)) {
        coverage.unresolvedReasons[reason] -= count;
        if (!coverage.unresolvedReasons[reason])
          delete coverage.unresolvedReasons[reason];
      }
      for (const [reason, count] of Object.entries(after.unresolvedReasons))
        coverage.unresolvedReasons[reason] =
          (coverage.unresolvedReasons[reason] ?? 0) + count;
    },
    signal,
  );
  coverage.checked = coverage.ready + coverage.noTargetTags;
  coverage.remaining = coverage.stale + coverage.errors + coverage.unknown;
  coverage.metadataSearchComplete = coverage.checked === tracks.length;
  return { ...coverage, durableCoverage: durable };
}
