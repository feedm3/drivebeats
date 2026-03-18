import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OfflineTrackStatus =
  | "queued"
  | "downloading"
  | "downloaded"
  | "failed"
  | "updating";

export interface OfflineCollectionMeta {
  enabled: boolean;
  trackFileIds: string[];
  totalBytes: number;
  downloadedCount: number;
  totalCount: number;
}

interface OfflineState {
  collections: Record<string, OfflineCollectionMeta>;
  trackStatus: Record<string, OfflineTrackStatus>;
  refCounts: Record<string, number>;
  isDownloading: boolean;

  enableCollection: (
    collectionId: string,
    trackFileIds: string[],
  ) => void;
  disableCollection: (collectionId: string) => void;
  syncCollectionTracks: (
    collectionId: string,
    newTrackFileIds: string[],
  ) => void;
  updateTrackStatus: (fileId: string, status: OfflineTrackStatus) => void;
  updateCollectionProgress: (
    collectionId: string,
    update: Partial<OfflineCollectionMeta>,
  ) => void;
  setIsDownloading: (downloading: boolean) => void;
  getCollectionProgress: (
    collectionId: string,
  ) => { downloadedCount: number; totalCount: number } | null;
  getTotalStorageUsed: () => number;
  clearAll: () => void;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      collections: {},
      trackStatus: {},
      refCounts: {},
      isDownloading: false,

      enableCollection: (collectionId, trackFileIds) => {
        const { collections, refCounts, trackStatus } = get();
        const newRefCounts = { ...refCounts };
        const newTrackStatus = { ...trackStatus };

        for (const fileId of trackFileIds) {
          newRefCounts[fileId] = (newRefCounts[fileId] ?? 0) + 1;
          if (!newTrackStatus[fileId]) {
            newTrackStatus[fileId] = "queued";
          }
        }

        set({
          collections: {
            ...collections,
            [collectionId]: {
              enabled: true,
              trackFileIds,
              totalBytes: 0,
              downloadedCount: 0,
              totalCount: trackFileIds.length,
            },
          },
          refCounts: newRefCounts,
          trackStatus: newTrackStatus,
        });
      },

      disableCollection: (collectionId) => {
        const { collections, refCounts, trackStatus } = get();
        const collection = collections[collectionId];
        if (!collection) return;

        const newRefCounts = { ...refCounts };
        const newTrackStatus = { ...trackStatus };

        for (const fileId of collection.trackFileIds) {
          const count = (newRefCounts[fileId] ?? 1) - 1;
          if (count <= 0) {
            delete newRefCounts[fileId];
            delete newTrackStatus[fileId];
          } else {
            newRefCounts[fileId] = count;
          }
        }

        const { [collectionId]: _, ...remainingCollections } = collections;

        set({
          collections: remainingCollections,
          refCounts: newRefCounts,
          trackStatus: newTrackStatus,
        });
      },

      syncCollectionTracks: (collectionId, newTrackFileIds) => {
        const { collections, refCounts, trackStatus } = get();
        const existing = collections[collectionId];
        if (!existing) return;

        const oldIds = new Set(existing.trackFileIds);
        const newIds = new Set(newTrackFileIds);
        const newRefCounts = { ...refCounts };
        const newTrackStatus = { ...trackStatus };

        for (const fileId of oldIds) {
          if (!newIds.has(fileId)) {
            const count = (newRefCounts[fileId] ?? 1) - 1;
            if (count <= 0) {
              delete newRefCounts[fileId];
              delete newTrackStatus[fileId];
            } else {
              newRefCounts[fileId] = count;
            }
          }
        }

        for (const fileId of newIds) {
          if (!oldIds.has(fileId)) {
            newRefCounts[fileId] = (newRefCounts[fileId] ?? 0) + 1;
            if (!newTrackStatus[fileId]) {
              newTrackStatus[fileId] = "queued";
            }
          }
        }

        set({
          collections: {
            ...collections,
            [collectionId]: {
              ...existing,
              trackFileIds: newTrackFileIds,
              totalCount: newTrackFileIds.length,
            },
          },
          refCounts: newRefCounts,
          trackStatus: newTrackStatus,
        });
      },

      updateTrackStatus: (fileId, status) => {
        set((state) => ({
          trackStatus: { ...state.trackStatus, [fileId]: status },
        }));
      },

      updateCollectionProgress: (collectionId, update) => {
        set((state) => {
          const existing = state.collections[collectionId];
          if (!existing) return state;
          return {
            collections: {
              ...state.collections,
              [collectionId]: { ...existing, ...update },
            },
          };
        });
      },

      setIsDownloading: (downloading) => {
        set({ isDownloading: downloading });
      },

      getCollectionProgress: (collectionId) => {
        const collection = get().collections[collectionId];
        if (!collection) return null;
        return {
          downloadedCount: collection.downloadedCount,
          totalCount: collection.totalCount,
        };
      },

      getTotalStorageUsed: () => {
        return Object.values(get().collections).reduce(
          (sum, c) => sum + c.totalBytes,
          0,
        );
      },

      clearAll: () => {
        set({
          collections: {},
          trackStatus: {},
          refCounts: {},
          isDownloading: false,
        });
      },
    }),
    {
      name: "drivebeats-offline",
      partialize: (state) => ({
        collections: state.collections,
        trackStatus: state.trackStatus,
        refCounts: state.refCounts,
      }),
    },
  ),
);
