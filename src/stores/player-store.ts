import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DriveFile, FolderEntry } from "@/types";

type RepeatMode = "off" | "one" | "all";

const MAX_CACHE_SIZE = 20;

let fetchAbortController: AbortController | null = null;

interface PlayerState {
  currentTrack: DriveFile | null;
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
    accessToken: string,
    autoplay?: boolean,
  ) => Promise<void>;
  playTrack: (
    track: DriveFile,
    playlist: DriveFile[],
    accessToken: string,
    folderStack: FolderEntry[],
    playlistId?: string,
  ) => void;
  fetchAndPlay: (fileId: string, accessToken: string) => Promise<void>;
  togglePlay: () => void;
  next: (accessToken: string) => void;
  previous: (accessToken: string) => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (p: boolean) => void;
  restoreTrack: (accessToken: string) => Promise<void>;
  resetPlayback: () => void;
  clearCache: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
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

      loadTrack: async (fileId, accessToken, autoplay = true) => {
        // Abort any in-flight fetch so a stale download can't overwrite audio.src
        fetchAbortController?.abort();
        const controller = new AbortController();
        fetchAbortController = controller;

        const audio = get().initAudio();
        const { blobCache } = get();
        const cached = blobCache.get(fileId);

        const applySource = async (source: string) => {
          audio.pause();
          audio.src = source;
          audio.currentTime = 0;

          if (autoplay) {
            await audio.play();
          } else {
            audio.load();
            set({ isPlaying: false, currentTime: 0 });
          }
        };

        if (cached) {
          if (controller.signal.aborted) return;
          await applySource(cached);
          set({ isLoading: false });
          return;
        }

        set({ isLoading: true });
        try {
          const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: controller.signal,
            },
          );
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
          if (controller.signal.aborted) return;

          await applySource(blobUrl);
          set({ isLoading: false });
        } catch (e) {
          if (controller.signal.aborted) return;
          set({ isLoading: false });
          throw e;
        }
      },

      fetchAndPlay: async (fileId, accessToken) => {
        await get().loadTrack(fileId, accessToken, true);
      },

      playTrack: (track, playlist, accessToken, folderStack, playlistId) => {
        get().initAudio();
        const index = playlist.findIndex((f) => f.id === track.id);

        set({
          currentTrack: track,
          playingFolderStack: playlistId ? [] : folderStack,
          playingPlaylistId: playlistId ?? null,
          playlist,
          currentIndex: index,
          isPlaying: true,
          currentTime: 0,
          duration: 0,
        });

        get()
          .loadTrack(track.id, accessToken, true)
          .catch(() => {
            set({ isPlaying: false });
          });
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

      next: (accessToken) => {
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

        get().playTrack(
          playlist[nextIndex],
          playlist,
          accessToken,
          get().playingFolderStack,
          get().playingPlaylistId ?? undefined,
        );
      },

      previous: (accessToken) => {
        const { audio, playlist, currentIndex } = get();
        if (playlist.length === 0) return;

        if (audio && audio.currentTime > 3) {
          audio.currentTime = 0;
          return;
        }

        const prevIndex =
          currentIndex - 1 < 0 ? playlist.length - 1 : currentIndex - 1;
        get().playTrack(
          playlist[prevIndex],
          playlist,
          accessToken,
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

      restoreTrack: async (accessToken) => {
        const { currentTrack, audio } = get();
        if (!currentTrack) return;
        if (audio?.src) return;
        await get().loadTrack(currentTrack.id, accessToken, false);
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
