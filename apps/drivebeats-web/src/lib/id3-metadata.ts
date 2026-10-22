import type { MetadataOutcome } from "@/lib/metadata-cache-types";

export interface Id3Metadata {
  title?: string;
  artist?: string;
  album?: string;
}

export function sanitizeMetadataText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
}

export async function extractId3MetadataResult(
  blob: Blob,
): Promise<MetadataOutcome> {
  try {
    const jsmediatags = (await import("jsmediatags")).default;
    return await new Promise((resolve) => {
      new jsmediatags.Reader(blob)
        .setTagsToRead(["title", "artist", "album"])
        .read({
          onSuccess({ tags }) {
            const metadata = {
              title: sanitizeMetadataText(tags.title),
              artist: sanitizeMetadataText(tags.artist),
              album: sanitizeMetadataText(tags.album),
            };
            resolve({
              status: Object.values(metadata).some(Boolean)
                ? "ready"
                : "no_target_tags",
              tags: metadata,
              loadedVia: "local_blob",
            });
          },
          onError() {
            // Unknown/malformed formats are not evidence of absent target tags.
            resolve({
              status: "unresolved",
              reason: "parse_error",
              loadedVia: "local_blob",
            });
          },
        });
    });
  } catch {
    return {
      status: "unresolved",
      reason: "parse_error",
      loadedVia: "local_blob",
    };
  }
}

/** Compatibility for callers only interested in successful text extraction. */
export async function extractId3Metadata(
  blob: Blob,
): Promise<Id3Metadata | null> {
  const result = await extractId3MetadataResult(blob);
  return result.status === "ready" ? (result.tags ?? null) : null;
}
