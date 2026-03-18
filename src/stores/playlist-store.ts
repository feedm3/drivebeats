import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  addCloudPlaylistTracks,
  createCloudPlaylist,
  deleteCloudPlaylist,
  fetchCloudLibrarySync,
  removeCloudPlaylistTrack,
  renameCloudPlaylist,
  reorderCloudPlaylistTracks,
} from "@/lib/cloud-library-api";
import { resolveParentFolderName } from "@/lib/resolve-parent-folder";
import type { Playlist, PlaylistTrack } from "@/types";

const PLAYLIST_SYNC_ERROR =
  "Could not sync playlists. Restored the last cloud state.";

const playlistMutationQueues = new Map<string, Promise<void>>();

function queuePlaylistMutation(playlistId: string, task: () => Promise<void>) {
  const previous = playlistMutationQueues.get(playlistId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const settled = next.finally(() => {
    if (playlistMutationQueues.get(playlistId) === settled) {
      playlistMutationQueues.delete(playlistId);
    }
  });
  playlistMutationQueues.set(playlistId, settled);
  return settled;
}

interface PlaylistState {
  playlists: Playlist[];
  activePlaylistId: string | null;
  isCloudHydrated: boolean;
  isCloudSyncing: boolean;
  createPlaylist: (name: string) => Promise<string>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTracks: (playlistId: string, tracks: PlaylistTrack[]) => Promise<void>;
  removeTrack: (playlistId: string, fileId: string) => Promise<void>;
  reorderTracks: (
    playlistId: string,
    fromIndex: number,
    toIndex: number,
  ) => Promise<void>;
  setActivePlaylist: (id: string | null) => void;
  replacePlaylistsFromCloud: (playlists: Playlist[]) => void;
  syncFromCloud: () => Promise<void>;
  clearCloudState: () => void;
}

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      playlists: [],
      activePlaylistId: null,
      isCloudHydrated: false,
      isCloudSyncing: false,

      createPlaylist: async (name) => {
        const id = crypto.randomUUID();
        const playlist: Playlist = { id, name, tracks: [] };
        set({ playlists: [...get().playlists, playlist] });

        try {
          await queuePlaylistMutation(id, () =>
            createCloudPlaylist({ id, name }),
          );
        } catch (error) {
          console.error("Create playlist sync failed:", error);
          await get().syncFromCloud();
          toast.error(PLAYLIST_SYNC_ERROR);
          throw error;
        }

        return id;
      },

      renamePlaylist: async (id, name) => {
        set({
          playlists: get().playlists.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        });

        try {
          await queuePlaylistMutation(id, () => renameCloudPlaylist(id, name));
        } catch (error) {
          console.error("Rename playlist sync failed:", error);
          await get().syncFromCloud();
          toast.error(PLAYLIST_SYNC_ERROR);
        }
      },

      deletePlaylist: async (id) => {
        const activePlaylistId =
          get().activePlaylistId === id ? null : get().activePlaylistId;
        set({
          playlists: get().playlists.filter((p) => p.id !== id),
          activePlaylistId,
        });

        try {
          await queuePlaylistMutation(id, () => deleteCloudPlaylist(id));
        } catch (error) {
          console.error("Delete playlist sync failed:", error);
          await get().syncFromCloud();
          toast.error(PLAYLIST_SYNC_ERROR);
        }
      },

      addTracks: async (playlistId, tracks) => {
        const normalizedTracks = tracks.map((t) => ({
          ...t,
          parentFolderName:
            t.parentFolderName ?? resolveParentFolderName(t.parents?.[0]),
        }));

        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const existingIds = new Set(p.tracks.map((t) => t.fileId));
            const newTracks = normalizedTracks.filter(
              (t) => !existingIds.has(t.fileId),
            );
            return { ...p, tracks: [...p.tracks, ...newTracks] };
          }),
        });

        try {
          await queuePlaylistMutation(playlistId, () =>
            addCloudPlaylistTracks(playlistId, { tracks: normalizedTracks }),
          );
        } catch (error) {
          console.error("Add tracks sync failed:", error);
          await get().syncFromCloud();
          toast.error(PLAYLIST_SYNC_ERROR);
        }
      },

      removeTrack: async (playlistId, fileId) => {
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            return {
              ...p,
              tracks: p.tracks.filter((t) => t.fileId !== fileId),
            };
          }),
        });

        try {
          await queuePlaylistMutation(playlistId, () =>
            removeCloudPlaylistTrack(playlistId, fileId),
          );
        } catch (error) {
          console.error("Remove track sync failed:", error);
          await get().syncFromCloud();
          toast.error(PLAYLIST_SYNC_ERROR);
        }
      },

      reorderTracks: async (playlistId, fromIndex, toIndex) => {
        let orderedFileIds: string[] = [];
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const tracks = [...p.tracks];
            const [moved] = tracks.splice(fromIndex, 1);
            tracks.splice(toIndex, 0, moved);
            orderedFileIds = tracks.map((track) => track.fileId);
            return { ...p, tracks };
          }),
        });

        try {
          await queuePlaylistMutation(playlistId, () =>
            reorderCloudPlaylistTracks(playlistId, { fileIds: orderedFileIds }),
          );
        } catch (error) {
          console.error("Reorder tracks sync failed:", error);
          await get().syncFromCloud();
          toast.error(PLAYLIST_SYNC_ERROR);
        }
      },

      setActivePlaylist: (id) => {
        set({ activePlaylistId: id });
      },

      replacePlaylistsFromCloud: (playlists) => {
        const activePlaylistId = get().activePlaylistId;
        set({
          playlists,
          activePlaylistId: playlists.some(
            (playlist) => playlist.id === activePlaylistId,
          )
            ? activePlaylistId
            : null,
          isCloudHydrated: true,
          isCloudSyncing: false,
        });
      },

      syncFromCloud: async () => {
        set({ isCloudSyncing: true });
        try {
          const data = await fetchCloudLibrarySync();
          get().replacePlaylistsFromCloud(data.playlists);
        } finally {
          set({ isCloudSyncing: false });
        }
      },

      clearCloudState: () => {
        set({
          playlists: [],
          activePlaylistId: null,
          isCloudHydrated: false,
          isCloudSyncing: false,
        });
      },
    }),
    {
      name: "drivebeats-playlists",
      partialize: (state) => ({ playlists: state.playlists }),
    },
  ),
);
