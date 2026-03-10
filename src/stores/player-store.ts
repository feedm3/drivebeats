import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

type RepeatMode = "off" | "one" | "all";

const MAX_CACHE_SIZE = 20;

let fetchAbortController: AbortController | null = null;

/**
 * Try to derive a folder stack for a track by looking up its parent folder
 * in the imported library and folder cache. Returns a minimal stack
 * [Library, parentFolder] if found, otherwise [].
 */
function deriveFolderStack(track: DriveFile): FolderEntry[] {
  const { rootFolders } = useImportedDriveStore.getState();
  const cache = useFolderCacheStore.getState().cache;

  const buildPathFromFolderId = (folderId: string): FolderEntry[] => {
    const rootFolder = rootFolders.find((folder) => folder.id === folderId);
    if (rootFolder) {
      return [...INITIAL_STACK, { id: rootFolder.id, name: rootFolder.name }];
    }

    for (const [candidateAncestorId, entry] of cache) {
      const folder = entry.files.find(
        (file) => file.id === folderId && file.mimeType === FOLDER_MIME,
      );
      if (!folder) continue;

      const ancestor = rootFolders.find(
        (rootFolderItem) => rootFolderItem.id === candidateAncestorId,
      );
      if (ancestor) {
        return [
          ...INITIAL_STACK,
          { id: ancestor.id, name: ancestor.name },
          { id: folder.id, name: folder.name },
        ];
      }

      return [...INITIAL_STACK, { id: folder.id, name: folder.name }];
    }

    return [];
  };

  const parentId = track.parents?.[0];
  if (parentId) {
    const path = buildPathFromFolderId(parentId);
    if (path.length > 0) {
      return path;
    }
  }

  // Fallback for older persisted smart-collection items that don't have parents.
  for (const [folderId, entry] of cache) {
    if (entry.files.some((file) => file.id === track.id)) {
      return buildPathFromFolderId(folderId);
    }
  }

  return [];
}

interface PlayerState {
  currentTrack: DriveFile | null;
  pendingTrackId: string | null;
  playingFolderStack: FolderEntry[];
  playingPlaylistId: string | null;
  playlist: DriveFile[];
  currentIndex: number;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  isLoading: boolean;
  audio: HTMLAudioElement | null;
  blobCache: Map<string, string>;
  initAudio: () => HTMLAudioElement;
  loadTrack: (
    fileId: string,
    autoplay?: boolean,
    beforeApply?: () => void,
  ) => Promise<boolean>;
  playTrack: (
    track: DriveFile,
    playlist: DriveFile[],
    folderStack: FolderEntry[],
    playlistId?: string,
  ) => Promise<void>;
  fetchAndPlay: (fileId: string) => Promise<boolean>;
  togglePlay: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (p: boolean) => void;
  restoreTrack: () => Promise<void>;
  resetPlayback: () => void;
  clearCache: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      pendingTrackId: null,
      playingFolderStack: [],
      playingPlaylistId: null,
      playlist: [],
      currentIndex: -1,
      isPlaying: false,
      duration: 0,
      currentTime: 0,
      volume: 0.7,
      isMuted: false,
      shuffle: false,
      repeat: "off",
      isLoading: false,
      audio: null,
      blobCache: new Map(),

      initAudio: () => {
        const existing = get().audio;
        if (existing) return existing;
        const audio = new Audio();
        audio.volume = get().isMuted ? 0 : get().volume;
        set({ audio });
        return audio;
      },

      loadTrack: async (fileId, autoplay = true, beforeApply) => {
        // Abort any in-flight fetch so a stale download can't overwrite audio.src
        fetchAbortController?.abort();
        const controller = new AbortController();
        fetchAbortController = controller;

        const audio = get().initAudio();
        const { blobCache } = get();
        const cached = blobCache.get(fileId);

        const applySource = async (source: string) => {
          audio.pause();
          beforeApply?.();
          audio.src = source;
          audio.currentTime = 0;

          if (autoplay) {
            await audio.play();
          } else {
            audio.load();
            set({ isPlaying: false, currentTime: 0, duration: 0 });
          }

          return true;
        };

        if (cached) {
          if (controller.signal.aborted) return false;
          await applySource(cached);
          set({ isLoading: false });
          return true;
        }

        set({ isLoading: true });
        try {
          const authStore = useAuthStore.getState();
          let accessToken = await authStore.getValidAccessToken();
          if (!accessToken) {
            throw new Error("Missing valid access token");
          }

          const fetchTrack = (token: string) =>
            fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
              },
            );

          let res = await fetchTrack(accessToken);
          if (res.status === 401) {
            const refreshed = await useAuthStore
              .getState()
              .refreshAccessToken();
            accessToken = refreshed
              ? useAuthStore.getState().accessToken
              : null;

            if (!accessToken) {
              throw new Error("Unable to refresh access token");
            }

            res = await fetchTrack(accessToken);
          }

          if (!res.ok) throw new Error(`Drive API returned ${res.status}`);

          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);

          // LRU eviction: remove oldest entry if cache is full
          if (blobCache.size >= MAX_CACHE_SIZE) {
            const oldestEntry = blobCache.keys().next();
            if (!oldestEntry.done) {
              const oldestKey = oldestEntry.value;
              const oldestUrl = blobCache.get(oldestKey);
              if (oldestUrl) {
                URL.revokeObjectURL(oldestUrl);
              }
              blobCache.delete(oldestKey);
            }
          }
          blobCache.set(fileId, blobUrl);

          // If a newer fetch started while we were downloading, don't touch audio
          if (controller.signal.aborted) return false;

          await applySource(blobUrl);
          set({ isLoading: false });
          return true;
        } catch (e) {
          if (controller.signal.aborted) return false;
          set({ isLoading: false });
          throw e;
        }
      },

      fetchAndPlay: async (fileId) => {
        return get().loadTrack(fileId, true);
      },

      playTrack: async (track, playlist, folderStack, playlistId) => {
        get().initAudio();
        const index = playlist.findIndex((f) => f.id === track.id);

        // Mark the target row active immediately, but keep currentTrack
        // pointing at the playing song until audio actually starts.
        set({
          pendingTrackId: track.id,
          playlist,
          currentIndex: index,
          playingFolderStack: playlistId
            ? deriveFolderStack(track)
            : folderStack,
          playingPlaylistId: playlistId ?? null,
        });

        try {
          await get().loadTrack(track.id, true, () => {
            set({
              currentTrack: track,
              pendingTrackId: null,
              isPlaying: true,
              currentTime: 0,
              duration: 0,
            });
          });
        } catch {
          // Loading failed — clear pending so the old track stays active.
          set({ pendingTrackId: null });
        }
      },

      togglePlay: () => {
        const { audio, isPlaying } = get();
        if (!audio) return;
        if (isPlaying) {
          audio.pause();
        } else {
          audio.play();
        }
        set({ isPlaying: !isPlaying });
      },

      next: async () => {
        const { playlist, currentIndex, shuffle, repeat } = get();
        if (playlist.length === 0) return;

        let nextIndex: number;
        if (shuffle) {
          nextIndex = Math.floor(Math.random() * playlist.length);
        } else {
          nextIndex = currentIndex + 1;
          if (nextIndex >= playlist.length) {
            if (repeat === "all") {
              nextIndex = 0;
            } else {
              return;
            }
          }
        }

        await get().playTrack(
          playlist[nextIndex],
          playlist,
          get().playingFolderStack,
          get().playingPlaylistId ?? undefined,
        );
      },

      previous: async () => {
        const { audio, playlist, currentIndex } = get();
        if (playlist.length === 0) return;

        if (audio && audio.currentTime > 3) {
          audio.currentTime = 0;
          return;
        }

        const prevIndex =
          currentIndex - 1 < 0 ? playlist.length - 1 : currentIndex - 1;
        await get().playTrack(
          playlist[prevIndex],
          playlist,
          get().playingFolderStack,
          get().playingPlaylistId ?? undefined,
        );
      },

      seek: (time) => {
        const { audio } = get();
        if (audio) {
          audio.currentTime = time;
          set({ currentTime: time });
        }
      },

      setVolume: (vol) => {
        const { audio } = get();
        if (audio) {
          audio.volume = vol;
        }
        set({ volume: vol, isMuted: vol === 0 });
      },

      toggleMute: () => {
        const { audio, isMuted, volume } = get();
        if (!audio) return;
        if (isMuted) {
          audio.volume = volume || 0.7;
          set({ isMuted: false });
        } else {
          audio.volume = 0;
          set({ isMuted: true });
        }
      },

      toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

      cycleRepeat: () =>
        set((s) => {
          const modes: RepeatMode[] = ["off", "one", "all"];
          const idx = modes.indexOf(s.repeat);
          return { repeat: modes[(idx + 1) % 3] };
        }),

      setCurrentTime: (t) => set({ currentTime: t }),
      setDuration: (d) => set({ duration: d }),
      setIsPlaying: (p) => set({ isPlaying: p }),

      restoreTrack: async () => {
        const { currentTrack, audio } = get();
        if (!currentTrack) return;
        if (audio?.src) return;
        await get().loadTrack(currentTrack.id, false);
      },

      resetPlayback: () => {
        fetchAbortController?.abort();
        fetchAbortController = null;

        const { audio } = get();
        if (audio) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }

        set({
          currentTrack: null,
          pendingTrackId: null,
          playingFolderStack: [],
          playingPlaylistId: null,
          playlist: [],
          currentIndex: -1,
          isPlaying: false,
          duration: 0,
          currentTime: 0,
          isLoading: false,
        });
      },

      clearCache: () => {
        const { blobCache } = get();
        for (const url of blobCache.values()) {
          URL.revokeObjectURL(url);
        }
        blobCache.clear();
      },
    }),
    {
      name: "drivebeats-player",
      partialize: (state) => ({
        currentTrack: state.currentTrack,
        playingFolderStack: state.playingFolderStack,
        playingPlaylistId: state.playingPlaylistId,
        playlist: state.playlist,
        currentIndex: state.currentIndex,
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    },
  ),
);
