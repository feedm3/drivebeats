import {
  downloadGoogleDriveFileMedia,
  type GoogleDriveFileMetadataResponse,
  getGoogleDriveFileMetadata,
} from "@/lib/google-api";
import * as offlineDb from "@/lib/offline-db";
import { useAuthStore } from "@/stores/auth-store";
import { getFavoriteTracks, useLibraryStore } from "@/stores/library-store";
import {
  type OfflineTrackStatus,
  useOfflineStore,
} from "@/stores/offline-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { PlaylistTrack } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

let abortController: AbortController | null = null;
let queuePromise: Promise<void> | null = null;
const cancelledFileIds = new Set<string>();

function getCollectionTracks(collectionId: string): PlaylistTrack[] {
  if (collectionId === FAVORITES_COLLECTION_ID) {
    return getFavoriteTracks(useLibraryStore.getState().tracks);
  }
  if (collectionId === RECENTLY_PLAYED_COLLECTION_ID) {
    return [];
  }
  const playlist = usePlaylistStore
    .getState()
    .playlists.find((p) => p.id === collectionId);
  return playlist?.tracks ?? [];
}

async function downloadTrackBlob(
  fileId: string,
  signal: AbortSignal,
): Promise<Blob> {
  const authStore = useAuthStore.getState();
  let accessToken = await authStore.getValidAccessToken();
  if (!accessToken) throw new Error("No access token");

  let res = await downloadGoogleDriveFileMedia(fileId, accessToken, signal);
  if (res.status === 401) {
    const refreshed = await useAuthStore.getState().refreshAccessToken();
    accessToken = refreshed ? useAuthStore.getState().accessToken : null;
    if (!accessToken) throw new Error("Unable to refresh access token");
    res = await downloadGoogleDriveFileMedia(fileId, accessToken, signal);
  }

  if (!res.ok) throw new Error(`Drive API returned ${res.status}`);
  return res.blob();
}

async function fetchTrackMetadata(
  fileId: string,
): Promise<Pick<PlaylistTrack, "modifiedTime" | "size">> {
  const authStore = useAuthStore.getState();
  let accessToken = await authStore.getValidAccessToken();
  if (!accessToken) throw new Error("No access token");

  const params = new URLSearchParams({
    fields: "id,size,modifiedTime",
    supportsAllDrives: "true",
  });

  let res = await getGoogleDriveFileMetadata(fileId, accessToken, params);
  if (res.status === 401) {
    const refreshed = await useAuthStore.getState().refreshAccessToken();
    accessToken = refreshed ? useAuthStore.getState().accessToken : null;
    if (!accessToken) throw new Error("Unable to refresh access token");
    res = await getGoogleDriveFileMetadata(fileId, accessToken, params);
  }

  if (!res.ok) throw new Error(`Drive API returned ${res.status}`);
  const data = (await res.json()) as GoogleDriveFileMetadataResponse;
  return {
    size: data.size,
    modifiedTime: data.modifiedTime,
  };
}

async function downloadSingleTrack(
  track: PlaylistTrack,
  signal: AbortSignal,
): Promise<void> {
  const store = useOfflineStore.getState();

  if (cancelledFileIds.has(track.fileId)) {
    cancelledFileIds.delete(track.fileId);
    return;
  }

  const currentStatus = store.trackStatus[track.fileId];
  if (currentStatus === "downloaded" || currentStatus === "downloading") return;

  store.updateTrackStatus(
    track.fileId,
    currentStatus === "updating" ? "updating" : "downloading",
  );

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted || cancelledFileIds.has(track.fileId)) {
      cancelledFileIds.delete(track.fileId);
      return;
    }
    try {
      const blob = await downloadTrackBlob(track.fileId, signal);
      if (signal.aborted || cancelledFileIds.has(track.fileId)) {
        cancelledFileIds.delete(track.fileId);
        return;
      }

      await offlineDb.putTrack(track.fileId, {
        blob,
        sizeBytes: blob.size,
        mimeType: track.mimeType ?? "audio/mpeg",
        name: track.fileName,
        modifiedTime: track.modifiedTime,
        downloadedAt: Date.now(),
      });

      store.updateTrackStatus(track.fileId, "downloaded");
      return;
    } catch (e) {
      if (signal.aborted || cancelledFileIds.has(track.fileId)) {
        cancelledFileIds.delete(track.fileId);
        return;
      }
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * 4 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  if (cancelledFileIds.has(track.fileId)) {
    cancelledFileIds.delete(track.fileId);
    return;
  }
  store.updateTrackStatus(track.fileId, "failed");
  if (lastError) {
    console.warn(`Offline download failed for ${track.fileId}:`, lastError);
  }
}

async function runQueue(): Promise<void> {
  const store = useOfflineStore.getState();
  const queuedFileIds = Object.entries(store.trackStatus)
    .filter(
      ([, status]) =>
        status === "queued" || status === "failed" || status === "updating",
    )
    .map(([fileId]) => fileId);

  if (queuedFileIds.length === 0) {
    store.setIsDownloading(false);
    return;
  }

  if (!abortController || abortController.signal.aborted) {
    abortController = new AbortController();
  }
  const signal = abortController.signal;

  store.setIsDownloading(true);

  const allCollections = store.collections;

  const trackMap = new Map<string, PlaylistTrack>();
  for (const col of Object.values(allCollections)) {
    for (const fileId of col.trackFileIds) {
      if (!trackMap.has(fileId)) {
        const track = findTrackById(fileId);
        if (track) trackMap.set(fileId, track);
      }
    }
  }

  const pending = queuedFileIds
    .map((id) => trackMap.get(id))
    .filter((t): t is PlaylistTrack => !!t);

  let i = 0;
  const runNext = async (): Promise<void> => {
    while (i < pending.length && !signal.aborted) {
      const track = pending[i++];
      await downloadSingleTrack(track, signal);
      updateAllCollectionProgress();
    }
  };

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, pending.length) },
    () => runNext(),
  );
  await Promise.all(workers);

  updateAllCollectionProgress();
  store.setIsDownloading(false);
}

export async function processQueue(): Promise<void> {
  if (queuePromise) {
    return queuePromise;
  }

  queuePromise = runQueue().finally(() => {
    queuePromise = null;
  });

  return queuePromise;
}

function findTrackById(fileId: string): PlaylistTrack | undefined {
  const favorites = getFavoriteTracks(useLibraryStore.getState().tracks);
  const fromFav = favorites.find((t) => t.fileId === fileId);
  if (fromFav) return fromFav;

  for (const playlist of usePlaylistStore.getState().playlists) {
    const found = playlist.tracks.find((t) => t.fileId === fileId);
    if (found) return found;
  }
  return undefined;
}

function updateAllCollectionProgress(): void {
  const store = useOfflineStore.getState();
  for (const [collectionId, col] of Object.entries(store.collections)) {
    const downloadedCount = col.trackFileIds.filter(
      (id) => store.trackStatus[id] === "downloaded",
    ).length;
    store.updateCollectionProgress(collectionId, { downloadedCount });
  }
}

function getTrackSignature(tracks: PlaylistTrack[]): string {
  return tracks
    .map(
      (track) =>
        `${track.fileId}:${track.modifiedTime ?? ""}:${track.size ?? ""}`,
    )
    .join("|");
}

async function recoverOfflineState(): Promise<void> {
  const store = useOfflineStore.getState();
  const activeCollectionIds = Object.keys(store.collections);
  if (activeCollectionIds.length === 0) {
    return;
  }

  const trackedFileIds = Object.keys(store.refCounts);
  if (trackedFileIds.length === 0) {
    return;
  }

  try {
    const persistedTracks = await offlineDb.getAllTrackSizes();
    const downloadedIds = new Set(persistedTracks.map(({ fileId }) => fileId));

    useOfflineStore.setState((state) => {
      const nextTrackStatus: Record<string, OfflineTrackStatus> = {};

      for (const fileId of trackedFileIds) {
        const currentStatus = state.trackStatus[fileId];
        if (downloadedIds.has(fileId)) {
          nextTrackStatus[fileId] = "downloaded";
          continue;
        }

        nextTrackStatus[fileId] =
          currentStatus === "failed" ? "failed" : "queued";
      }

      return { trackStatus: nextTrackStatus };
    });
  } catch (error) {
    console.warn("Failed to recover offline downloads from IndexedDB:", error);

    useOfflineStore.setState((state) => ({
      trackStatus: Object.fromEntries(
        Object.entries(state.trackStatus).map(([fileId, status]) => [
          fileId,
          status === "downloading" || status === "updating" ? "queued" : status,
        ]),
      ),
    }));
  }

  updateAllCollectionProgress();

  const hasPendingDownloads = Object.values(
    useOfflineStore.getState().trackStatus,
  ).some(
    (status) =>
      status === "queued" || status === "failed" || status === "updating",
  );

  if (hasPendingDownloads) {
    void processQueue();
  }
}

export async function startCollectionDownload(
  collectionId: string,
): Promise<void> {
  const tracks = getCollectionTracks(collectionId);
  const fileIds = tracks.map((t) => t.fileId);

  if (fileIds.length === 0) return;

  if (useOfflineStore.getState().collections[collectionId]?.enabled) {
    await syncCollection(collectionId);
    return;
  }

  if (navigator.storage?.estimate) {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota && usage) {
        const remaining = quota - usage;
        const estimatedSize = tracks.reduce(
          (sum, t) => sum + (Number(t.size) || 5_000_000),
          0,
        );
        if (estimatedSize > remaining * 0.8) {
          console.warn(
            "Offline download may exceed 80% of remaining storage quota",
          );
        }
      }
    } catch {
      // storage estimate not available
    }
  }

  useOfflineStore.getState().enableCollection(collectionId, fileIds);

  await offlineDb.putCollection(collectionId, {
    enabled: true,
    trackFileIds: fileIds,
    totalBytes: 0,
    downloadedCount: 0,
    totalCount: fileIds.length,
    lastSyncedAt: Date.now(),
  });

  await processQueue();
}

export async function stopCollectionDownload(
  collectionId: string,
): Promise<void> {
  const store = useOfflineStore.getState();
  const collection = store.collections[collectionId];
  if (!collection) return;

  const fileIdsToRemove = collection.trackFileIds.filter((fileId) => {
    const refCount = (store.refCounts[fileId] ?? 1) - 1;
    return refCount <= 0;
  });

  // Abort in-flight downloads so workers exit immediately
  abortController?.abort();
  abortController = null;

  // Wait for active workers to finish (they exit fast due to abort signal)
  if (queuePromise) {
    await queuePromise.catch(() => {});
  }

  // Mark tracks as cancelled so any residual workers skip them
  for (const fileId of fileIdsToRemove) {
    cancelledFileIds.add(fileId);
  }

  store.disableCollection(collectionId);

  await Promise.all(fileIdsToRemove.map((id) => offlineDb.deleteTrack(id)));
  await offlineDb.deleteCollection(collectionId);

  // Restart downloads for surviving collections whose tracks were interrupted
  const updated = useOfflineStore.getState();
  if (Object.keys(updated.collections).length > 0) {
    const interrupted = Object.entries(updated.trackStatus).filter(
      ([, s]) => s === "downloading",
    );
    if (interrupted.length > 0) {
      useOfflineStore.setState((state) => ({
        trackStatus: {
          ...state.trackStatus,
          ...Object.fromEntries(
            interrupted.map(([id]) => [id, "queued" as const]),
          ),
        },
      }));
    }
    void processQueue();
  }
}

export async function syncCollection(
  collectionId: string,
  options: { revalidateMetadata?: boolean } = {},
): Promise<void> {
  const { revalidateMetadata = true } = options;
  const tracks = getCollectionTracks(collectionId);
  const fileIds = tracks.map((t) => t.fileId);

  const store = useOfflineStore.getState();
  const existing = store.collections[collectionId];
  if (!existing?.enabled) return;

  const oldIds = new Set(existing.trackFileIds);
  const newIds = new Set(fileIds);
  const staleTracks = revalidateMetadata
    ? await Promise.all(
        tracks.map(async (track) => {
          if (!oldIds.has(track.fileId)) {
            return null;
          }

          const offlineTrack = await offlineDb.getTrack(track.fileId);
          if (!offlineTrack) {
            return null;
          }

          try {
            const liveMetadata = await fetchTrackMetadata(track.fileId);
            if (
              liveMetadata.modifiedTime &&
              liveMetadata.modifiedTime !== offlineTrack.modifiedTime
            ) {
              return {
                fileId: track.fileId,
                modifiedTime: liveMetadata.modifiedTime,
                size: liveMetadata.size,
              };
            }
          } catch (error) {
            console.warn(
              `Failed to refresh metadata for offline track ${track.fileId}:`,
              error,
            );
          }

          if (
            track.modifiedTime &&
            track.modifiedTime !== offlineTrack.modifiedTime
          ) {
            return {
              fileId: track.fileId,
              modifiedTime: track.modifiedTime,
              size: track.size,
            };
          }

          return null;
        }),
      )
    : [];

  // Compute ref counts for removed tracks before mutating store
  const removedFileIds: string[] = [];
  for (const oldId of oldIds) {
    if (!newIds.has(oldId)) {
      const refCount = (store.refCounts[oldId] ?? 1) - 1;
      if (refCount <= 0) {
        removedFileIds.push(oldId);
      }
    }
  }

  // Atomically diff ref counts: decrement removed, increment added
  store.syncCollectionTracks(collectionId, fileIds);

  const changedTracks = staleTracks.filter(
    (track): track is NonNullable<(typeof staleTracks)[number]> =>
      track !== null,
  );
  if (changedTracks.length > 0) {
    const metadataById = new Map(
      changedTracks.map((track) => [
        track.fileId,
        { modifiedTime: track.modifiedTime, size: track.size },
      ]),
    );
    const changedTrackIds = changedTracks.map((track) => track.fileId);

    if (collectionId === FAVORITES_COLLECTION_ID) {
      useLibraryStore.setState((state) => ({
        tracks: Object.fromEntries(
          Object.entries(state.tracks).map(([fileId, track]) => {
            const metadata = metadataById.get(fileId);
            return [fileId, metadata ? { ...track, ...metadata } : track];
          }),
        ),
      }));
    } else {
      usePlaylistStore.setState((state) => ({
        playlists: state.playlists.map((playlist) =>
          playlist.id !== collectionId
            ? playlist
            : {
                ...playlist,
                tracks: playlist.tracks.map((track) => {
                  const metadata = metadataById.get(track.fileId);
                  return metadata ? { ...track, ...metadata } : track;
                }),
              },
        ),
      }));
    }

    useOfflineStore.setState((state) => ({
      trackStatus: {
        ...state.trackStatus,
        ...Object.fromEntries(
          changedTrackIds.map((fileId) => [fileId, "updating"]),
        ),
      },
    }));
  }

  // Delete orphaned blobs after store update
  await Promise.all(removedFileIds.map((id) => offlineDb.deleteTrack(id)));

  await offlineDb.putCollection(collectionId, {
    enabled: true,
    trackFileIds: fileIds,
    totalBytes: 0,
    downloadedCount: 0,
    totalCount: fileIds.length,
    lastSyncedAt: Date.now(),
  });

  await processQueue();
}

export async function removeAllDownloads(): Promise<void> {
  abortController?.abort();
  abortController = null;
  cancelledFileIds.clear();
  queuePromise = null;

  try {
    await offlineDb.clearAll();
  } catch (error) {
    console.warn("Failed to clear offline download database:", error);
  } finally {
    usePlayerStore.getState().clearCache();
    useOfflineStore.getState().clearAll();
    useOfflineStore.persist.clearStorage();
  }
}

let subscribed = false;

export function initOfflineSync(): void {
  if (subscribed) return;
  subscribed = true;

  void recoverOfflineState();

  // Sync when tracks change in offline-enabled collections
  usePlaylistStore.subscribe((state, prev) => {
    const enabledCollections = useOfflineStore.getState().collections;
    for (const playlist of state.playlists) {
      if (!enabledCollections[playlist.id]?.enabled) continue;
      const prevPlaylist = prev.playlists.find((p) => p.id === playlist.id);
      if (
        prevPlaylist &&
        getTrackSignature(prevPlaylist.tracks) !==
          getTrackSignature(playlist.tracks)
      ) {
        void syncCollection(playlist.id, { revalidateMetadata: false });
      }
    }
  });

  useLibraryStore.subscribe((state, prev) => {
    const enabledCollections = useOfflineStore.getState().collections;
    if (!enabledCollections[FAVORITES_COLLECTION_ID]?.enabled) return;
    const prevFavs = getFavoriteTracks(prev.tracks);
    const newFavs = getFavoriteTracks(state.tracks);
    if (getTrackSignature(prevFavs) !== getTrackSignature(newFavs)) {
      void syncCollection(FAVORITES_COLLECTION_ID, {
        revalidateMetadata: false,
      });
    }
  });

  // Re-process queue when coming back online
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      const { collections } = useOfflineStore.getState();
      if (Object.keys(collections).length > 0) {
        void processQueue();
      }
    });
  }
}
