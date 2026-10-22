import type { MetadataView } from "@/lib/track-metadata-loader";
import type { DriveFile } from "@/types";

export function buildMetadataCoverage(
  tracks: DriveFile[] | null,
  getState: (track: DriveFile) => MetadataView,
) {
  const counts = {
    ready: 0,
    noTargetTags: 0,
    unresolved: 0,
    stale: 0,
    errors: 0,
    unknown: 0,
  };
  const unresolvedReasons: Record<string, number> = {};
  const fields = { title: 0, artist: 0, album: 0 };
  for (const track of tracks ?? []) {
    const value = getState(track);
    if (value.freshness === "stale") counts.stale += 1;
    else if (value.freshness === "current" && value.status === "ready") {
      counts.ready += 1;
      for (const field of ["title", "artist", "album"] as const)
        if (value.tags?.[field]) fields[field] += 1;
    } else if (
      value.freshness === "current" &&
      value.status === "no_target_tags"
    )
      counts.noTargetTags += 1;
    else if (value.freshness === "current" && value.status === "unresolved") {
      counts.unresolved += 1;
      const reason = value.reason ?? value.error?.code ?? "unknown";
      unresolvedReasons[reason] = (unresolvedReasons[reason] ?? 0) + 1;
    } else if (value.status === "error") counts.errors += 1;
    else counts.unknown += 1;
  }
  const checked = counts.ready + counts.noTargetTags;
  const total = tracks ? tracks.length : null;
  const remaining = tracks
    ? counts.stale + counts.errors + counts.unknown
    : null;
  return {
    ...counts,
    checked,
    total,
    remaining,
    unresolvedReasons,
    fields,
    catalogComplete: Boolean(tracks),
    metadataSearchComplete: total !== null && checked === total,
  };
}
