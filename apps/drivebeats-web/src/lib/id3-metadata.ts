export interface Id3Metadata {
  title?: string;
  artist?: string;
  album?: string;
}

function sanitize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
}

export async function extractId3Metadata(
  blob: Blob,
): Promise<Id3Metadata | null> {
  const jsmediatags = (await import("jsmediatags")).default;

  return new Promise((resolve) => {
    jsmediatags.read(blob, {
      onSuccess(result: { tags: Record<string, unknown> }) {
        const { tags } = result;
        const title = sanitize(tags.title);
        const artist = sanitize(tags.artist);
        const album = sanitize(tags.album);

        if (!title && !artist && !album) {
          resolve(null);
          return;
        }

        resolve({ title, artist, album });
      },
      onError() {
        resolve(null);
      },
    });
  });
}
