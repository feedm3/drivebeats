import { create } from "zustand";
import type { DriveFile } from "@/types";

type RepeatMode = "off" | "one" | "all";

interface PlayerState {
  currentTrack: DriveFile | null;
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
  blobUrl: string | null;
  initAudio: () => HTMLAudioElement;
  playTrack: (track: DriveFile, playlist: DriveFile[], accessToken: string) => void;
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
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
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
  blobUrl: null,

  initAudio: () => {
    const existing = get().audio;
    if (existing) return existing;
    const audio = new Audio();
    audio.volume = get().volume;
    set({ audio });
    return audio;
  },

  fetchAndPlay: async (fileId, accessToken) => {
    const { blobUrl: prevBlobUrl } = get();
    if (prevBlobUrl) URL.revokeObjectURL(prevBlobUrl);

    set({ isLoading: true });
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`Drive API returned ${res.status}`);

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = get().audio;
      if (audio) {
        audio.src = blobUrl;
        await audio.play();
      }
      set({ blobUrl, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  playTrack: (track, playlist, accessToken) => {
    const audio = get().initAudio();
    const index = playlist.findIndex((f) => f.id === track.id);

    set({
      currentTrack: track,
      playlist,
      currentIndex: index,
      isPlaying: true,
    });

    get().fetchAndPlay(track.id, accessToken).catch(() => {
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

    get().playTrack(playlist[nextIndex], playlist, accessToken);
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
    get().playTrack(playlist[prevIndex], playlist, accessToken);
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
}));
