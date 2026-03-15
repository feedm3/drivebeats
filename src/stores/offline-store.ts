import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getSupportedAudioQuery, isSupportedAudioFile } from "@/lib/audio";
import {
  clearOfflineData,
  getAllOfflineManifests,
  getAllOfflineTrackRecords,
  putOfflineManifest,
  putOfflineTrackRecord,
  removeOfflineTrackRecord,
  toOfflineTrackRecord,
  type OfflineManifestRecord,
  type OfflineSource,
} from "@/lib/offline-cache";
import {
  downloadGoogleDriveFileMedia,
  listGoogleDriveFiles,
} from "@/lib/google-api";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import type { DriveFile, PlaylistTrack } from "@/types";
import { FOLDER_MIME } from "@/types";

const OFFLINE_WARNING_BYTES = 100 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 2;

export type OfflineItemStatus =
  | "not_cached"
  | "queued"
  | "downloading"
  | "cached"
  | "error"
  | "stale";

interface OfflineItemMeta {
  fileId: string;
  fileName: string;
  mimeType: string;
  status: OfflineItemStatus;
  sizeBytes: number;
  progressPct: number;
  updatedAt: number;
  errorMessage?: string;
  parents?: string[];
}

interface DownloadTask {
  file: DriveFile;
  source: OfflineSource;
}

interface OfflineState {
  offlineOnlyMode: boolean;
  isNetworkOffline: boolean;
  items: Record<string, OfflineItemMeta>;
  queue: DownloadTask[];
  activeDownloads: number;
  manifests: OfflineManifestRecord[];
  initialized: boolean;
  setOfflineOnlyMode: (enabled: boolean) => void;
  setNetworkOffline: (isOffline: boolean) => void;
  hydrateFromStorage: () => Promise<void>;
  queueTrackDownload: (file: DriveFile, source?: OfflineSource) => Promise<void>;
  queuePlaylistDownload: (
    playlistId: string,
    playlistName: string,
    tracks: PlaylistTrack[],
  ) => Promise<void>;
  queueFolderDownload: (
    folder: DriveFile,
    includeSubfolders: boolean,
  ) => Promise<void>;
  removeOfflineTrack: (fileId: string) => Promise<void>;
  clearAllOfflineData: () => Promise<void>;
  clearAllOfflineDataOnLogout: () => Promise<void>;
  processQueue: () => Promise<void>;
  isCached: (fileId: string) => boolean;
}

function dedupeById(files: DriveFile[]) {
  const byId = new Map<string, DriveFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }
  return [...byId.values()];
}

function sumBytes(files: DriveFile[]) {
  return files.reduce((sum, file) => sum + Number(file.size ?? 0), 0);
}

function mapPlaylistTrackToDriveFile(track: PlaylistTrack): DriveFile {
  return {
    id: track.fileId,
    name: track.fileName,
    mimeType: track.mimeType ?? "audio/mpeg",
    parents: track.parents,
    size: track.size,
  };
}

async function ensureCanDownload(files: DriveFile[]) {
  const knownSizedFiles = files.filter((file) => Number(file.size ?? 0) > 0);
  const estimated = sumBytes(knownSizedFiles);

  if (estimated > OFFLINE_WARNING_BYTES) {
    const sizeMb = (estimated / (1024 * 1024)).toFixed(1);
    return window.confirm(
      `This download is about ${sizeMb} MB. Do you want to continue?`,
    );
  }

  return true;
}

async function fetchFolderAudioFiles(
  folderId: string,
  includeSubfolders: boolean,
): Promise<DriveFile[]> {
  const cached = useFolderCacheStore.getState().getFiles(folderId);
  if (!includeSubfolders && cached) {
    return cached.files.filter((file) => !isFolder(file));
  }

  const authStore = useAuthStore.getState();
  const accessToken = await authStore.getValidAccessToken();
  if (!accessToken) {
    toast.error("Sign in required to cache files offline.");
    return [];
  }

  const queue = [folderId];
  const visited = new Set<string>();
  const tracks: DriveFile[] = [];

  while (queue.length > 0) {
    const currentFolderId = queue.shift();
    if (!currentFolderId || visited.has(currentFolderId)) continue;

    visited.add(currentFolderId);

    const response = await listGoogleDriveFiles(accessToken, {
      q: getSupportedAudioQuery(currentFolderId),
      fields: "files(id,name,mimeType,size,parents)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "1000",
    });

    if (!response.ok) continue;

    const body = (await response.json()) as { files?: DriveFile[] };
    const files = body.files ?? [];
    const folders = files.filter(isFolder);
    const audioTracks = files.filter((file) => !isFolder(file) && isSupportedAudioFile(file));

    tracks.push(...audioTracks);
    if (includeSubfolders) {
      for (const folder of folders) {
        queue.push(folder.id);
      }
    }
  }

  return dedupeById(tracks);
}

function isFolder(file: DriveFile) {
  return file.mimeType === FOLDER_MIME;
}

let queueProcessingPromise: Promise<void> | null = null;

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      offlineOnlyMode: false,
      isNetworkOffline: false,
      items: {},
      queue: [],
      activeDownloads: 0,
      manifests: [],
      initialized: false,

      setOfflineOnlyMode: (enabled) => {
        set({ offlineOnlyMode: enabled });
      },

      setNetworkOffline: (isOffline) => {
        set({ isNetworkOffline: isOffline });
      },

      hydrateFromStorage: async () => {
        const [records, manifests] = await Promise.all([
          getAllOfflineTrackRecords(),
          getAllOfflineManifests(),
        ]);

        set((state) => {
          const nextItems = { ...state.items };
          for (const record of records) {
            nextItems[record.fileId] = {
              fileId: record.fileId,
              fileName: record.fileName,
              mimeType: record.mimeType,
              status: "cached",
              sizeBytes: record.sizeBytes,
              progressPct: 100,
              updatedAt: record.cachedAt,
              parents: record.parents,
            };
          }

          return {
            items: nextItems,
            manifests,
            initialized: true,
          };
        });
      },

      queueTrackDownload: async (file, source = "single") => {
        const canProceed = await ensureCanDownload([file]);
        if (!canProceed) return;

        set((state) => {
          const existing = state.items[file.id];
          if (existing?.status === "cached" || existing?.status === "downloading") {
            return state;
          }

          return {
            queue: [...state.queue, { file, source }],
            items: {
              ...state.items,
              [file.id]: {
                fileId: file.id,
                fileName: file.name,
                mimeType: file.mimeType,
                status: "queued",
                sizeBytes: Number(file.size ?? 0),
                progressPct: 0,
                updatedAt: Date.now(),
                parents: file.parents,
              },
            },
          };
        });

        await get().processQueue();
      },

      queuePlaylistDownload: async (playlistId, playlistName, tracks) => {
        const files = dedupeById(tracks.map(mapPlaylistTrackToDriveFile).filter((file) => !isFolder(file)));
        if (files.length === 0) return;

        const canProceed = await ensureCanDownload(files);
        if (!canProceed) return;

        const fileIds = files.map((file) => file.id);
        await putOfflineManifest("playlist", playlistId, playlistName, fileIds);

        set((state) => ({
          manifests: [
            ...state.manifests.filter((manifest) => manifest.key !== `playlist:${playlistId}`),
            {
              key: `playlist:${playlistId}`,
              entityType: "playlist",
              entityId: playlistId,
              entityName: playlistName,
              fileIds,
              createdAt: Date.now(),
            },
          ],
        }));

        for (const file of files) {
          await get().queueTrackDownload(file, "playlist");
        }
      },

      queueFolderDownload: async (folder, includeSubfolders) => {
        const files = await fetchFolderAudioFiles(folder.id, includeSubfolders);
        if (files.length === 0) {
          toast.info("No audio files found in this folder.");
          return;
        }

        const canProceed = await ensureCanDownload(files);
        if (!canProceed) return;

        const fileIds = files.map((file) => file.id);
        await putOfflineManifest(
          "folder",
          folder.id,
          folder.name,
          fileIds,
          includeSubfolders,
        );

        set((state) => ({
          manifests: [
            ...state.manifests.filter((manifest) => manifest.key !== `folder:${folder.id}`),
            {
              key: `folder:${folder.id}`,
              entityType: "folder",
              entityId: folder.id,
              entityName: folder.name,
              fileIds,
              includeSubfolders,
              createdAt: Date.now(),
            },
          ],
        }));

        for (const file of files) {
          await get().queueTrackDownload(file, "folder");
        }
      },

      removeOfflineTrack: async (fileId) => {
        await removeOfflineTrackRecord(fileId);
        set((state) => {
          const nextItems = { ...state.items };
          const existing = nextItems[fileId];
          if (existing) {
            nextItems[fileId] = {
              ...existing,
              status: "not_cached",
              progressPct: 0,
              errorMessage: undefined,
              updatedAt: Date.now(),
            };
          }

          const nextManifests = state.manifests
            .map((manifest) => ({
              ...manifest,
              fileIds: manifest.fileIds.filter((id) => id !== fileId),
            }))
            .filter((manifest) => manifest.fileIds.length > 0);

          return {
            items: nextItems,
            manifests: nextManifests,
          };
        });
      },

      clearAllOfflineData: async () => {
        await clearOfflineData();
        set((state) => ({
          queue: [],
          manifests: [],
          items: Object.fromEntries(
            Object.entries(state.items).map(([fileId, item]) => [
              fileId,
              {
                ...item,
                status: "not_cached" as const,
                progressPct: 0,
                errorMessage: undefined,
                updatedAt: Date.now(),
              },
            ]),
          ),
        }));
      },

      clearAllOfflineDataOnLogout: async () => {
        await get().clearAllOfflineData();
        useOfflineStore.persist.clearStorage();
      },

      processQueue: async () => {
        if (queueProcessingPromise) {
          return queueProcessingPromise;
        }

        queueProcessingPromise = (async () => {
          while (
            get().queue.length > 0 &&
            get().activeDownloads < MAX_CONCURRENT_DOWNLOADS
          ) {
            const nextTask = get().queue[0];
            if (!nextTask) break;

            set((state) => ({
              queue: state.queue.slice(1),
              activeDownloads: state.activeDownloads + 1,
              items: {
                ...state.items,
                [nextTask.file.id]: {
                  fileId: nextTask.file.id,
                  fileName: nextTask.file.name,
                  mimeType: nextTask.file.mimeType,
                  status: "downloading",
                  progressPct: 0,
                  sizeBytes: Number(nextTask.file.size ?? 0),
                  updatedAt: Date.now(),
                  parents: nextTask.file.parents,
                },
              },
            }));

            const downloadPromise = (async () => {
              try {
                const accessToken = await useAuthStore.getState().getValidAccessToken();
                if (!accessToken) {
                  throw new Error("Missing valid access token");
                }

                const response = await downloadGoogleDriveFileMedia(
                  nextTask.file.id,
                  accessToken,
                );

                if (!response.ok) {
                  throw new Error(`Drive API returned ${response.status}`);
                }

                const blob = await response.blob();
                const record = toOfflineTrackRecord(nextTask.file, blob, nextTask.source);
                await putOfflineTrackRecord(record);

                set((state) => ({
                  items: {
                    ...state.items,
                    [nextTask.file.id]: {
                      fileId: nextTask.file.id,
                      fileName: nextTask.file.name,
                      mimeType: nextTask.file.mimeType,
                      status: "cached",
                      progressPct: 100,
                      sizeBytes: blob.size,
                      updatedAt: Date.now(),
                      parents: nextTask.file.parents,
                    },
                  },
                }));
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Download failed";

                set((state) => ({
                  items: {
                    ...state.items,
                    [nextTask.file.id]: {
                      fileId: nextTask.file.id,
                      fileName: nextTask.file.name,
                      mimeType: nextTask.file.mimeType,
                      status: "error",
                      progressPct: 0,
                      sizeBytes: Number(nextTask.file.size ?? 0),
                      updatedAt: Date.now(),
                      errorMessage: message,
                      parents: nextTask.file.parents,
                    },
                  },
                }));
              } finally {
                set((state) => ({
                  activeDownloads: Math.max(0, state.activeDownloads - 1),
                }));
              }
            })();

            await downloadPromise;
          }
        })()
          .finally(() => {
            queueProcessingPromise = null;
            if (get().queue.length > 0) {
              void get().processQueue();
            }
          });

        return queueProcessingPromise;
      },

      isCached: (fileId) => get().items[fileId]?.status === "cached",
    }),
    {
      name: "drivebeats-offline",
      partialize: (state) => ({
        offlineOnlyMode: state.offlineOnlyMode,
        items: state.items,
      }),
    },
  ),
);

export function useEffectiveOfflineOnlyMode() {
  return useOfflineStore((state) => state.offlineOnlyMode || state.isNetworkOffline);
}

export function isTrackCachedOffline(fileId: string) {
  return useOfflineStore.getState().items[fileId]?.status === "cached";
}

export function getOfflineTotals() {
  const items = Object.values(useOfflineStore.getState().items);
  const cachedItems = items.filter((item) => item.status === "cached");
  return {
    offlineSongCount: cachedItems.length,
    offlineBytes: cachedItems.reduce((sum, item) => sum + item.sizeBytes, 0),
  };
}
