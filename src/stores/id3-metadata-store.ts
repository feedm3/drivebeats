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

const BATCH_DELAY_MS = 2_000;
const MAX_BATCH_SIZE = 50;

interface PendingUpload {
  fileId: string;
  modifiedTime?: string;
  title?: string;
  artist?: string;
  album?: string;
}

const pendingUploads: PendingUpload[] = [];
let batchTimerId: ReturnType<typeof setTimeout> | null = null;

function flushMetadataBatch() {
  batchTimerId = null;
  if (pendingUploads.length === 0) return;

  const batch = pendingUploads.splice(0, MAX_BATCH_SIZE);
  import("@/lib/cloud-library-api")
    .then(({ saveCloudTrackMetadata }) => saveCloudTrackMetadata(batch))
    .catch(() => {
      // Non-fatal: metadata will be re-extracted next play
    });

  // If there are leftovers, schedule another flush
  if (pendingUploads.length > 0) {
    batchTimerId = setTimeout(flushMetadataBatch, BATCH_DELAY_MS);
  }
}

function enqueueMetadataUpload(entry: PendingUpload) {
  pendingUploads.push(entry);
  if (pendingUploads.length >= MAX_BATCH_SIZE) {
    if (batchTimerId !== null) {
      clearTimeout(batchTimerId);
    }
    flushMetadataBatch();
  } else if (batchTimerId === null) {
    batchTimerId = setTimeout(flushMetadataBatch, BATCH_DELAY_MS);
  }
}

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

            enqueueMetadataUpload({
              fileId,
              modifiedTime,
              title: metadata.title,
              artist: metadata.artist,
              album: metadata.album,
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
