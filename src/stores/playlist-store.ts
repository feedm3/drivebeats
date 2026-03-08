import { create } from "zustand";
import type { Playlist, PlaylistTrack } from "@/types";

const STORAGE_KEY = "drivebeats-playlists";

function loadPlaylists(): Playlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt data
  }
  return [];
}

function persistPlaylists(playlists: Playlist[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  } catch {
    // storage full — silently ignore
  }
}

interface PlaylistState {
  playlists: Playlist[];
  activePlaylistId: string | null;
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addTracks: (playlistId: string, tracks: PlaylistTrack[]) => void;
  removeTrack: (playlistId: string, fileId: string) => void;
  reorderTracks: (
    playlistId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  setActivePlaylist: (id: string | null) => void;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: loadPlaylists(),
  activePlaylistId: null,

  createPlaylist: (name) => {
    const id = crypto.randomUUID();
    const playlist: Playlist = { id, name, tracks: [] };
    const playlists = [...get().playlists, playlist];
    set({ playlists });
    persistPlaylists(playlists);
    return id;
  },

  renamePlaylist: (id, name) => {
    const playlists = get().playlists.map((p) =>
      p.id === id ? { ...p, name } : p,
    );
    set({ playlists });
    persistPlaylists(playlists);
  },

  deletePlaylist: (id) => {
    const playlists = get().playlists.filter((p) => p.id !== id);
    const activePlaylistId =
      get().activePlaylistId === id ? null : get().activePlaylistId;
    set({ playlists, activePlaylistId });
    persistPlaylists(playlists);
  },

  addTracks: (playlistId, tracks) => {
    const playlists = get().playlists.map((p) => {
      if (p.id !== playlistId) return p;
      const existingIds = new Set(p.tracks.map((t) => t.fileId));
      const newTracks = tracks.filter((t) => !existingIds.has(t.fileId));
      return { ...p, tracks: [...p.tracks, ...newTracks] };
    });
    set({ playlists });
    persistPlaylists(playlists);
  },

  removeTrack: (playlistId, fileId) => {
    const playlists = get().playlists.map((p) => {
      if (p.id !== playlistId) return p;
      return { ...p, tracks: p.tracks.filter((t) => t.fileId !== fileId) };
    });
    set({ playlists });
    persistPlaylists(playlists);
  },

  reorderTracks: (playlistId, fromIndex, toIndex) => {
    const playlists = get().playlists.map((p) => {
      if (p.id !== playlistId) return p;
      const tracks = [...p.tracks];
      const [moved] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, moved);
      return { ...p, tracks };
    });
    set({ playlists });
    persistPlaylists(playlists);
  },

  setActivePlaylist: (id) => {
    set({ activePlaylistId: id });
  },
}));
