import { metadataEnvironmentKey } from "@/lib/drive-metadata-reader";
import {
  getKnownTrackDescriptorRevision,
  resolveKnownTrack,
} from "@/lib/known-track-resolver";
import { scanMetadataRecords } from "@/lib/metadata-cache-db";
import {
  getMetadataFreshness,
  type MetadataRecord,
} from "@/lib/metadata-cache-types";
import { getLocalMetadataAccountId } from "@/lib/metadata-local-account";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import {
  getLibrarySearchImportsSignature,
  useLibrarySearchStore,
} from "@/stores/library-search-store";

export interface MetadataDiagnosticTrack {
  id: string;
  fileName: string;
  reason: string;
  status: "unresolved" | "error";
  retryable: boolean;
  retryAfterMs?: number;
  checkedAt?: number;
  /** Persisted budget_exceeded is a per-track reader limit, not a batch pause.
   * Legacy records do not identify which of these limits was reached. */
  budget?: { scope: "track"; maxBytes: number; maxRangeAttempts: number };
}
export class MetadataDiagnosticsChangedError extends Error {
  readonly code = "metadata_changed";
  constructor() {
    super("The account or Library changed. Open the details again.");
  }
}

/** Reads the same local cache on demand. Opening details never starts media work. */
export async function getMetadataUnresolvedDiagnostics(
  options: { signal?: AbortSignal; limit?: number } = {},
) {
  const limit = Math.max(
    1,
    Math.min(20, Math.floor(options.limit ?? 20) || 20),
  );
  const observedAt = Date.now();
  const accountId = getLocalMetadataAccountId();
  const store = useId3MetadataStore.getState();
  const search = useLibrarySearchStore.getState();
  const catalog = search.catalog;
  const signature = getLibrarySearchImportsSignature();
  if (
    !accountId ||
    store.accountId !== accountId ||
    !catalog ||
    catalog.userId !== accountId ||
    search.invalidated ||
    catalog.importsSignature !== signature
  )
    return {
      observedAt,
      available: false,
      reasons: [] as { code: string; count: number }[],
      tracks: [] as MetadataDiagnosticTrack[],
      total: 0,
      truncated: false,
      limit,
    };
  const generation = store.generation;
  const revision = getKnownTrackDescriptorRevision();
  const current = () => {
    const live = useLibrarySearchStore.getState();
    return (
      getLocalMetadataAccountId() === accountId &&
      useId3MetadataStore.getState().accountId === accountId &&
      useId3MetadataStore.getState().generation === generation &&
      live.catalog === catalog &&
      !live.invalidated &&
      getLibrarySearchImportsSignature() === signature &&
      getKnownTrackDescriptorRevision() === revision
    );
  };
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    if (!current()) throw new MetadataDiagnosticsChangedError();
  };
  assertCurrent();
  const environment = metadataEnvironmentKey();
  const byId = new Map(catalog.tracks.map((track) => [track.id, track]));
  const issues = new Map<
    string,
    Omit<MetadataDiagnosticTrack, "id" | "fileName">
  >();
  function consider(fileId: string, record?: MetadataRecord) {
    const known = resolveKnownTrack(accountId as string, fileId);
    if (!known || !byId.has(fileId)) return;
    if (
      record?.accountId === accountId &&
      record.status === "unresolved" &&
      getMetadataFreshness(record, known.track, environment) === "current"
    ) {
      const reason = record.reason ?? "unknown";
      issues.set(fileId, {
        reason,
        status: "unresolved",
        retryable: false,
        checkedAt: record.checkedAt,
        ...(reason === "budget_exceeded"
          ? {
              budget: {
                scope: "track",
                maxBytes: 1024 * 1024,
                maxRangeAttempts: 4,
              } as const,
            }
          : {}),
      });
      return;
    }
    issues.delete(fileId);
  }
  // Memory includes pending writes. Only saved unresolved outcomes belong to
  // the warning count; transient transport failures stay in progress/pause state.
  // Durable outcomes
  // fill only evicted records; neither path loads tags into the memory store.
  for (let offset = 0; offset < catalog.tracks.length; offset += 100) {
    assertCurrent();
    for (const track of catalog.tracks.slice(offset, offset + 100))
      consider(track.id, store.records[track.id]);
    if (offset + 100 < catalog.tracks.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await scanMetadataRecords(
    accountId,
    (record) => {
      if (
        current() &&
        !store.records[record.fileId] &&
        record.accountId === accountId
      )
        consider(record.fileId, record);
    },
    options.signal,
  );
  assertCurrent();
  const counts = new Map<string, number>();
  for (const issue of issues.values())
    counts.set(issue.reason, (counts.get(issue.reason) ?? 0) + 1);
  const tracks: MetadataDiagnosticTrack[] = [];
  for (const track of catalog.tracks) {
    const issue = issues.get(track.id);
    if (!issue) continue;
    const known = resolveKnownTrack(accountId, track.id);
    if (!known) throw new MetadataDiagnosticsChangedError();
    tracks.push({ id: track.id, fileName: known.track.name, ...issue });
    if (tracks.length === limit) break;
  }
  assertCurrent();
  return {
    observedAt,
    available: true,
    reasons: [...counts].map(([code, count]) => ({ code, count })),
    tracks,
    total: issues.size,
    truncated: issues.size > tracks.length,
    limit,
  };
}
