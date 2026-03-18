import { create } from "zustand";
import { persist } from "zustand/middleware";
import { resolveParentFolderName } from "@/lib/resolve-parent-folder";
import type { Playlist, PlaylistTrack } from "@/types";

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

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      playlists: [],
      activePlaylistId: null,

      createPlaylist: (name) => {
        const id = crypto.randomUUID();
        const playlist: Playlist = { id, name, tracks: [] };
        set({ playlists: [...get().playlists, playlist] });
        return id;
      },

      renamePlaylist: (id, name) => {
        set({
          playlists: get().playlists.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        });
      },

      deletePlaylist: (id) => {
        const activePlaylistId =
          get().activePlaylistId === id ? null : get().activePlaylistId;
        set({
          playlists: get().playlists.filter((p) => p.id !== id),
          activePlaylistId,
        });
      },

      addTracks: (playlistId, tracks) => {
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const existingIds = new Set(p.tracks.map((t) => t.fileId));
            const newTracks = tracks
              .filter((t) => !existingIds.has(t.fileId))
              .map((t) => ({
                ...t,
                parentFolderName:
                  t.parentFolderName ??
                  resolveParentFolderName(t.parents?.[0]),
              }));
            return { ...p, tracks: [...p.tracks, ...newTracks] };
          }),
        });
      },

      removeTrack: (playlistId, fileId) => {
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            return {
              ...p,
              tracks: p.tracks.filter((t) => t.fileId !== fileId),
            };
          }),
        });
      },

      reorderTracks: (playlistId, fromIndex, toIndex) => {
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const tracks = [...p.tracks];
            const [moved] = tracks.splice(fromIndex, 1);
            tracks.splice(toIndex, 0, moved);
            return { ...p, tracks };
          }),
        });
      },

      setActivePlaylist: (id) => {
        set({ activePlaylistId: id });
      },
    }),
    {
      name: "drivebeats-playlists",
      partialize: (state) => ({ playlists: state.playlists }),
    },
  ),
);
