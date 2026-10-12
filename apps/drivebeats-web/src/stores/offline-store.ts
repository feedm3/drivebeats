import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OfflineTrackStatus =
  | "queued"
  | "downloading"
  | "downloaded"
  | "failed"
  | "updating";

export type OfflineDownloadPhase =
  | "idle"
  | "authorizing"
  | "fetching"
  | "reading"
  | "storing";

export type OfflineDownloadErrorCategory =
  | "network"
  | "timeout"
  | "auth-required"
  | "access-denied"
  | "missing-file"
  | "rate-limited"
  | "server"
  | "storage-full"
  | "storage-unavailable"
  | "integrity"
  | "unknown";

export type StoragePersistenceStatus =
  | "unknown"
  | "granted"
  | "not-granted"
  | "unsupported";

export interface OfflineTrackJob {
  status: OfflineTrackStatus;
  phase: OfflineDownloadPhase;
  attempt: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  errorCategory?: OfflineDownloadErrorCategory;
}

export interface OfflineCollectionMeta {
  enabled: boolean;
  trackFileIds: string[];
  totalBytes: number;
  downloadedCount: number;
  totalCount: number;
}

export interface OfflineState {
  collections: Record<string, OfflineCollectionMeta>;
  trackJobs: Record<string, OfflineTrackJob>;
  /**
   * Compatibility projection for existing consumers. The structured job map is
   * authoritative and every store mutation keeps this projection in sync.
   */
  trackStatus: Record<string, OfflineTrackStatus>;
  refCounts: Record<string, number>;
  isDownloading: boolean;
  storagePersistence: StoragePersistenceStatus;

  enableCollection: (collectionId: string, trackFileIds: string[]) => void;
  disableCollection: (collectionId: string) => void;
  syncCollectionTracks: (
    collectionId: string,
    newTrackFileIds: string[],
  ) => void;
  updateTrackJob: (
    fileId: string,
    update: Partial<OfflineTrackJob> & Pick<OfflineTrackJob, "status">,
  ) => void;
  updateTrackStatus: (fileId: string, status: OfflineTrackStatus) => void;
  removeTrackJob: (fileId: string) => void;
  updateCollectionProgress: (
    collectionId: string,
    update: Partial<OfflineCollectionMeta>,
  ) => void;
  setIsDownloading: (downloading: boolean) => void;
  setStoragePersistence: (status: StoragePersistenceStatus) => void;
  resetRetryableJobs: (fileIds: Iterable<string>) => void;
  getCollectionProgress: (
    collectionId: string,
  ) => { downloadedCount: number; totalCount: number } | null;
  getTotalStorageUsed: () => number;
  clearAll: () => void;
}

const EMPTY_JOB: OfflineTrackJob = {
  status: "queued",
  phase: "idle",
  attempt: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCollection(value: unknown): OfflineCollectionMeta | null {
  if (!isRecord(value) || !Array.isArray(value.trackFileIds)) return null;

  const trackFileIds = [
    ...new Set(
      value.trackFileIds.filter((id): id is string => typeof id === "string"),
    ),
  ];

  return {
    enabled: value.enabled !== false,
    trackFileIds,
    totalBytes:
      typeof value.totalBytes === "number" && value.totalBytes >= 0
        ? value.totalBytes
        : 0,
    downloadedCount:
      typeof value.downloadedCount === "number" && value.downloadedCount >= 0
        ? Math.min(value.downloadedCount, trackFileIds.length)
        : 0,
    totalCount: trackFileIds.length,
  };
}

function normalizeStatus(value: unknown): OfflineTrackStatus {
  if (value === "downloaded" || value === "failed") return value;
  return "queued";
}

function normalizeJob(value: unknown): OfflineTrackJob {
  if (!isRecord(value)) {
    return { ...EMPTY_JOB };
  }

  const status = normalizeStatus(value.status);
  const phase: OfflineDownloadPhase =
    status === "queued" || status === "downloaded" || status === "failed"
      ? "idle"
      : value.phase === "authorizing" ||
          value.phase === "fetching" ||
          value.phase === "reading" ||
          value.phase === "storing"
        ? value.phase
        : "idle";

  const job: OfflineTrackJob = {
    status,
    phase,
    attempt:
      typeof value.attempt === "number" && value.attempt >= 0
        ? Math.floor(value.attempt)
        : 0,
  };

  if (typeof value.lastAttemptAt === "number") {
    job.lastAttemptAt = value.lastAttemptAt;
  }
  if (typeof value.nextAttemptAt === "number") {
    job.nextAttemptAt = value.nextAttemptAt;
  }
  if (
    value.errorCategory === "network" ||
    value.errorCategory === "timeout" ||
    value.errorCategory === "auth-required" ||
    value.errorCategory === "access-denied" ||
    value.errorCategory === "missing-file" ||
    value.errorCategory === "rate-limited" ||
    value.errorCategory === "server" ||
    value.errorCategory === "storage-full" ||
    value.errorCategory === "storage-unavailable" ||
    value.errorCategory === "integrity" ||
    value.errorCategory === "unknown"
  ) {
    job.errorCategory = value.errorCategory;
  }

  return job;
}

function projectStatuses(
  jobs: Record<string, OfflineTrackJob>,
): Record<string, OfflineTrackStatus> {
  return Object.fromEntries(
    Object.entries(jobs).map(([fileId, job]) => [fileId, job.status]),
  );
}

/**
 * Rebuilds derived state from collection intent. This deliberately ignores a
 * persisted ref-count map because partial/corrupt writes must not delete a
 * valid shared Blob during the next reconciliation.
 */
export function migrateOfflineState(
  persisted: unknown,
  _version: number,
): Pick<
  OfflineState,
  | "collections"
  | "trackJobs"
  | "trackStatus"
  | "refCounts"
  | "storagePersistence"
> {
  const source = isRecord(persisted) ? persisted : {};
  const rawCollections = isRecord(source.collections) ? source.collections : {};
  const collections: Record<string, OfflineCollectionMeta> = {};
  const refCounts: Record<string, number> = {};

  for (const [collectionId, rawCollection] of Object.entries(rawCollections)) {
    const collection = normalizeCollection(rawCollection);
    if (!collection?.enabled) continue;
    collections[collectionId] = collection;
    for (const fileId of collection.trackFileIds) {
      refCounts[fileId] = (refCounts[fileId] ?? 0) + 1;
    }
  }

  const rawJobs = isRecord(source.trackJobs) ? source.trackJobs : {};
  const oldStatuses = isRecord(source.trackStatus) ? source.trackStatus : {};
  const trackJobs: Record<string, OfflineTrackJob> = {};

  for (const fileId of Object.keys(refCounts)) {
    trackJobs[fileId] =
      fileId in rawJobs
        ? normalizeJob(rawJobs[fileId])
        : {
            ...EMPTY_JOB,
            status: normalizeStatus(oldStatuses[fileId]),
          };
  }

  const storagePersistence: StoragePersistenceStatus =
    source.storagePersistence === "granted" ||
    source.storagePersistence === "not-granted" ||
    source.storagePersistence === "unsupported"
      ? source.storagePersistence
      : "unknown";

  return {
    collections,
    trackJobs,
    trackStatus: projectStatuses(trackJobs),
    refCounts,
    storagePersistence,
  };
}

function reconcileMembership(
  collections: Record<string, OfflineCollectionMeta>,
  trackJobs: Record<string, OfflineTrackJob>,
  collectionId: string,
  trackFileIds: string[],
) {
  const normalizedIds = [...new Set(trackFileIds)];
  const nextCollections = {
    ...collections,
    [collectionId]: {
      enabled: true,
      trackFileIds: normalizedIds,
      totalBytes: collections[collectionId]?.totalBytes ?? 0,
      downloadedCount: collections[collectionId]?.downloadedCount ?? 0,
      totalCount: normalizedIds.length,
    },
  };
  const nextRefCounts: Record<string, number> = {};

  for (const collection of Object.values(nextCollections)) {
    if (!collection.enabled) continue;
    for (const fileId of collection.trackFileIds) {
      nextRefCounts[fileId] = (nextRefCounts[fileId] ?? 0) + 1;
    }
  }

  const nextJobs: Record<string, OfflineTrackJob> = {};
  for (const fileId of Object.keys(nextRefCounts)) {
    nextJobs[fileId] = trackJobs[fileId] ?? { ...EMPTY_JOB };
  }

  return {
    collections: nextCollections,
    refCounts: nextRefCounts,
    trackJobs: nextJobs,
    trackStatus: projectStatuses(nextJobs),
  };
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      collections: {},
      trackJobs: {},
      trackStatus: {},
      refCounts: {},
      isDownloading: false,
      storagePersistence: "unknown",

      enableCollection: (collectionId, trackFileIds) => {
        set((state) =>
          reconcileMembership(
            state.collections,
            state.trackJobs,
            collectionId,
            trackFileIds,
          ),
        );
      },

      disableCollection: (collectionId) => {
        set((state) => {
          if (!state.collections[collectionId]) return state;
          const { [collectionId]: _removed, ...collections } =
            state.collections;
          const refCounts: Record<string, number> = {};

          for (const collection of Object.values(collections)) {
            if (!collection.enabled) continue;
            for (const fileId of collection.trackFileIds) {
              refCounts[fileId] = (refCounts[fileId] ?? 0) + 1;
            }
          }

          const trackJobs = Object.fromEntries(
            Object.entries(state.trackJobs).filter(
              ([fileId]) => refCounts[fileId] !== undefined,
            ),
          );

          return {
            collections,
            refCounts,
            trackJobs,
            trackStatus: projectStatuses(trackJobs),
          };
        });
      },

      syncCollectionTracks: (collectionId, newTrackFileIds) => {
        set((state) => {
          if (!state.collections[collectionId]) return state;
          return reconcileMembership(
            state.collections,
            state.trackJobs,
            collectionId,
            newTrackFileIds,
          );
        });
      },

      updateTrackJob: (fileId, update) => {
        set((state) => {
          if (state.refCounts[fileId] === undefined) return state;
          const job = {
            ...(state.trackJobs[fileId] ?? EMPTY_JOB),
            ...update,
          };
          return {
            trackJobs: { ...state.trackJobs, [fileId]: job },
            trackStatus: { ...state.trackStatus, [fileId]: job.status },
          };
        });
      },

      updateTrackStatus: (fileId, status) => {
        get().updateTrackJob(fileId, {
          status,
          phase: status === "downloading" ? "fetching" : "idle",
        });
      },

      removeTrackJob: (fileId) => {
        set((state) => {
          const { [fileId]: _job, ...trackJobs } = state.trackJobs;
          const { [fileId]: _status, ...trackStatus } = state.trackStatus;
          return { trackJobs, trackStatus };
        });
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

      setStoragePersistence: (storagePersistence) => {
        set({ storagePersistence });
      },

      resetRetryableJobs: (fileIds) => {
        const selected = new Set(fileIds);
        set((state) => {
          const trackJobs = { ...state.trackJobs };
          for (const fileId of selected) {
            const current = trackJobs[fileId];
            if (!current || current.status === "downloaded") continue;
            trackJobs[fileId] = {
              status: "queued",
              phase: "idle",
              attempt: 0,
            };
          }
          return {
            trackJobs,
            trackStatus: projectStatuses(trackJobs),
          };
        });
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
          (sum, collection) => sum + collection.totalBytes,
          0,
        );
      },

      clearAll: () => {
        set({
          collections: {},
          trackJobs: {},
          trackStatus: {},
          refCounts: {},
          isDownloading: false,
          storagePersistence: "unknown",
        });
      },
    }),
    {
      name: "drivebeats-offline",
      version: 1,
      migrate: migrateOfflineState,
      partialize: (state) => ({
        collections: state.collections,
        trackJobs: state.trackJobs,
        trackStatus: state.trackStatus,
        refCounts: state.refCounts,
        storagePersistence: state.storagePersistence,
      }),
    },
  ),
);
