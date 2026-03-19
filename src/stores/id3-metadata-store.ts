import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Id3Metadata } from "@/lib/id3-metadata";

export interface CachedId3Metadata extends Id3Metadata {
  modifiedTime?: string;
}

interface Id3MetadataState {
  cache: Record<string, CachedId3Metadata>;
  setMetadata: (fileId: string, metadata: CachedId3Metadata) => void;
  hydrateFromSync: (
    record: Record<string, CachedId3Metadata> | undefined,
  ) => void;
  requestMetadata: (
    fileId: string,
    blob: Blob,
    modifiedTime?: string,
    isSynced?: boolean,
  ) => void;
  clearAll: () => void;
}

const extractionInFlight = new Set<string>();

export const useId3MetadataStore = create<Id3MetadataState>()(
  persist(
    (set, get) => ({
      cache: {},

      setMetadata: (fileId, metadata) => {
        set((state) => ({
          cache: { ...state.cache, [fileId]: metadata },
        }));
      },

      hydrateFromSync: (record) => {
        if (!record) return;

        set((state) => {
          const next = { ...state.cache };
          for (const [fileId, meta] of Object.entries(record)) {
            const existing = next[fileId];
            // Only overwrite if local cache doesn't have it or has no modifiedTime
            if (
              !existing ||
              (meta.modifiedTime && existing.modifiedTime !== meta.modifiedTime)
            ) {
              next[fileId] = meta;
            }
          }
          return { cache: next };
        });
      },

      requestMetadata: (fileId, blob, modifiedTime, isSynced = false) => {
        const existing = get().cache[fileId];

        // Skip if cache entry exists with matching modifiedTime
        if (
          existing &&
          (!modifiedTime ||
            !existing.modifiedTime ||
            existing.modifiedTime === modifiedTime)
        ) {
          return;
        }

        // Deduplicate concurrent extractions
        if (extractionInFlight.has(fileId)) return;
        extractionInFlight.add(fileId);

        import("@/lib/id3-metadata")
          .then(({ extractId3Metadata }) => extractId3Metadata(blob))
          .then((metadata) => {
            if (!metadata) return;

            const cached: CachedId3Metadata = {
              ...metadata,
              modifiedTime,
            };

            get().setMetadata(fileId, cached);

            // Only upload to cloud if this track belongs to a synced collection
            if (!isSynced) return;

            import("@/lib/cloud-library-api")
              .then(({ saveCloudTrackMetadata }) =>
                saveCloudTrackMetadata([
                  {
                    fileId,
                    modifiedTime,
                    title: metadata.title,
                    artist: metadata.artist,
                    album: metadata.album,
                  },
                ]),
              )
              .catch(() => {
                // Non-fatal: metadata will be re-extracted next play
              });
          })
          .catch(() => {
            // Extraction failed — silently skip
          })
          .finally(() => {
            extractionInFlight.delete(fileId);
          });
      },

      clearAll: () => {
        set({ cache: {} });
      },
    }),
    {
      name: "drivebeats-id3-metadata",
      partialize: (state) => ({ cache: state.cache }),
    },
  ),
);
