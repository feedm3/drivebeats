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
import type { AddPlaylistTracksResult } from "@/lib/cloud-library-shared";
import {
  getPlaylistLimitError,
  getRemainingPlaylistTrackSlots,
  hasReachedPlaylistCountLimit,
  MAX_TRACKS_PER_PLAYLIST,
  PLAYLIST_COUNT_LIMIT_ERROR,
  PLAYLIST_TRACK_LIMIT_CODE,
} from "@/lib/playlist-limits";
import { resolveParentFolderName } from "@/lib/resolve-parent-folder";
import type { Playlist, PlaylistTrack } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

const PLAYLIST_SYNC_ERROR =
  "Could not sync playlists. Restored the last cloud state.";

const playlistMutationQueues = new Map<string, Promise<void>>();

function queuePlaylistMutation<T>(playlistId: string, task: () => Promise<T>) {
  const previous = playlistMutationQueues.get(playlistId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const settled = next.finally(() => {
    if (playlistMutationQueues.get(playlistId) === settled) {
      playlistMutationQueues.delete(playlistId);
    }
  });
  playlistMutationQueues.set(
    playlistId,
    settled.then(
      () => undefined,
      () => undefined,
    ),
  );
  return settled;
}

export function hasPendingPlaylistMutations() {
  return playlistMutationQueues.size > 0;
}

export async function waitForPendingPlaylistMutations() {
  if (playlistMutationQueues.size === 0) {
    return;
  }

  await Promise.allSettled([...playlistMutationQueues.values()]);
}

function isBuiltInCollectionId(playlistId: string | null) {
  return (
    playlistId === FAVORITES_COLLECTION_ID ||
    playlistId === RECENTLY_PLAYED_COLLECTION_ID
  );
}

interface PlaylistState {
  playlists: Playlist[];
  activePlaylistId: string | null;
  isCloudHydrated: boolean;
  isCloudSyncing: boolean;
  createPlaylist: (name: string) => Promise<string | null>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTracks: (
    playlistId: string,
    tracks: PlaylistTrack[],
  ) => Promise<AddPlaylistTracksResult>;
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
        if (hasReachedPlaylistCountLimit(get().playlists.length)) {
          toast.warning(PLAYLIST_COUNT_LIMIT_ERROR);
          return null;
        }

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
          const limitError = getPlaylistLimitError(error);
          if (limitError) {
            toast.warning(limitError.message);
            return null;
          }

          toast.error(PLAYLIST_SYNC_ERROR);
          return null;
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
        const playlist = get().playlists.find((item) => item.id === playlistId);
        if (!playlist) {
          return {
            addedCount: 0,
            duplicateCount: 0,
            skippedCount: tracks.length,
            reachedTrackLimit: false,
          };
        }

        const normalizedTracks = tracks.map((t) => ({
          ...t,
          parentFolderName:
            t.parentFolderName ?? resolveParentFolderName(t.parents?.[0]),
        }));
        const existingIds = new Set(playlist.tracks.map((t) => t.fileId));
        const uniqueTracks = normalizedTracks.filter(
          (track) => !existingIds.has(track.fileId),
        );
        const remainingSlots = getRemainingPlaylistTrackSlots(
          playlist.tracks.length,
        );
        const tracksToAdd = uniqueTracks.slice(0, remainingSlots);
        const optimisticResult: AddPlaylistTracksResult = {
          addedCount: tracksToAdd.length,
          duplicateCount: normalizedTracks.length - uniqueTracks.length,
          skippedCount: uniqueTracks.length - tracksToAdd.length,
          reachedTrackLimit:
            playlist.tracks.length + tracksToAdd.length >=
            MAX_TRACKS_PER_PLAYLIST,
        };

        if (tracksToAdd.length === 0) {
          return {
            addedCount: 0,
            duplicateCount: normalizedTracks.length - uniqueTracks.length,
            skippedCount: uniqueTracks.length,
            reachedTrackLimit:
              playlist.tracks.length >= MAX_TRACKS_PER_PLAYLIST,
          };
        }

        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== playlistId) return p;
            return { ...p, tracks: [...p.tracks, ...tracksToAdd] };
          }),
        });

        try {
          const result = await queuePlaylistMutation(playlistId, () =>
            addCloudPlaylistTracks(playlistId, { tracks: normalizedTracks }),
          );
          if (
            result.addedCount !== optimisticResult.addedCount ||
            result.duplicateCount !== optimisticResult.duplicateCount ||
            result.skippedCount !== optimisticResult.skippedCount
          ) {
            await get().syncFromCloud();
          }

          return result;
        } catch (error) {
          console.error("Add tracks sync failed:", error);
          await get().syncFromCloud();
          const limitError = getPlaylistLimitError(error);
          if (limitError) {
            toast.warning(limitError.message);
            return {
              addedCount: 0,
              duplicateCount: normalizedTracks.length - uniqueTracks.length,
              skippedCount: uniqueTracks.length,
              reachedTrackLimit: limitError.code === PLAYLIST_TRACK_LIMIT_CODE,
            };
          }

          toast.error(PLAYLIST_SYNC_ERROR);
          return {
            addedCount: 0,
            duplicateCount: normalizedTracks.length - uniqueTracks.length,
            skippedCount: uniqueTracks.length,
            reachedTrackLimit: false,
          };
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
          activePlaylistId:
            isBuiltInCollectionId(activePlaylistId) ||
            playlists.some((playlist) => playlist.id === activePlaylistId)
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
