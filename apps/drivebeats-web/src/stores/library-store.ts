import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  fetchCloudLibrarySync,
  removeCloudFavorite,
  setCloudFavorite,
} from "@/lib/cloud-library-api";
import type { PlaylistTrack } from "@/types";

const MAX_RECENT_TRACKS = 50;
const FAVORITES_SYNC_ERROR =
  "Could not sync favorites. Restored the last cloud state.";

const favoriteMutationQueues = new Map<string, Promise<void>>();

function queueFavoriteMutation(fileId: string, task: () => Promise<void>) {
  const previous = favoriteMutationQueues.get(fileId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const settled = next.finally(() => {
    if (favoriteMutationQueues.get(fileId) === settled) {
      favoriteMutationQueues.delete(fileId);
    }
  });
  favoriteMutationQueues.set(fileId, settled);
  return settled;
}

export function hasPendingFavoriteMutations() {
  return favoriteMutationQueues.size > 0;
}

export async function waitForPendingFavoriteMutations() {
  if (favoriteMutationQueues.size === 0) {
    return;
  }

  await Promise.allSettled([...favoriteMutationQueues.values()]);
}

export interface TrackLibraryMeta extends PlaylistTrack {
  isFavorite?: boolean;
  lastPlayedAt?: number;
  playCount: number;
}

interface LibraryState {
  tracks: Record<string, TrackLibraryMeta>;
  isCloudHydrated: boolean;
  isCloudSyncing: boolean;
  setFavorite: (track: PlaylistTrack, isFavorite: boolean) => Promise<void>;
  toggleFavorite: (track: PlaylistTrack) => Promise<void>;
  markPlayed: (track: PlaylistTrack) => void;
  removeFromRecent: (fileId: string) => void;
  clearRecent: () => void;
  replaceFavoritesFromCloud: (favorites: PlaylistTrack[]) => void;
  syncFavoritesFromCloud: () => Promise<void>;
  clearCloudFavorites: () => void;
  clearAll: () => void;
}

function toLibraryMeta(
  existing: TrackLibraryMeta | undefined,
  track: PlaylistTrack,
): TrackLibraryMeta {
  return {
    fileId: track.fileId,
    fileName: track.fileName,
    mimeType: track.mimeType ?? existing?.mimeType,
    size: track.size ?? existing?.size,
    modifiedTime: track.modifiedTime ?? existing?.modifiedTime,
    parents: track.parents ?? existing?.parents,
    parentFolderName: track.parentFolderName ?? existing?.parentFolderName,
    isFavorite: existing?.isFavorite,
    lastPlayedAt: existing?.lastPlayedAt,
    playCount: existing?.playCount ?? 0,
  };
}

function sortTracksByName(a: PlaylistTrack, b: PlaylistTrack) {
  return a.fileName.localeCompare(b.fileName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function pruneTrack(track: TrackLibraryMeta | undefined) {
  if (!track) {
    return undefined;
  }

  const isFavorite = Boolean(track.isFavorite);
  const hasRecent = typeof track.lastPlayedAt === "number";

  if (!isFavorite && !hasRecent) {
    return undefined;
  }

  return track;
}

export function getFavoriteTracks(
  tracks: Record<string, TrackLibraryMeta>,
): PlaylistTrack[] {
  return Object.values(tracks)
    .filter((track) => track.isFavorite)
    .sort(sortTracksByName)
    .map(
      ({
        fileId,
        fileName,
        mimeType,
        size,
        modifiedTime,
        parents,
        parentFolderName,
      }) => ({
        fileId,
        fileName,
        mimeType,
        size,
        modifiedTime,
        parents,
        parentFolderName,
      }),
    );
}

export function getRecentlyPlayedTracks(
  tracks: Record<string, TrackLibraryMeta>,
  limit = MAX_RECENT_TRACKS,
): PlaylistTrack[] {
  return Object.values(tracks)
    .filter((track) => track.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, limit)
    .map(
      ({
        fileId,
        fileName,
        mimeType,
        size,
        modifiedTime,
        parents,
        parentFolderName,
      }) => ({
        fileId,
        fileName,
        mimeType,
        size,
        modifiedTime,
        parents,
        parentFolderName,
      }),
    );
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      tracks: {},
      isCloudHydrated: false,
      isCloudSyncing: false,

      setFavorite: async (track, isFavorite) => {
        set((state) => {
          const existing = state.tracks[track.fileId];
          const nextTrack = {
            ...toLibraryMeta(existing, track),
            isFavorite,
          };

          const pruned = pruneTrack(nextTrack);
          if (!pruned) {
            const { [track.fileId]: _removed, ...remaining } = state.tracks;
            return { tracks: remaining };
          }

          return {
            tracks: {
              ...state.tracks,
              [track.fileId]: pruned,
            },
          };
        });

        try {
          await queueFavoriteMutation(track.fileId, () =>
            isFavorite ? setCloudFavorite(track) : removeCloudFavorite(track),
          );
        } catch (error) {
          console.error("Favorite sync failed:", error);
          await get().syncFavoritesFromCloud();
          toast.error(FAVORITES_SYNC_ERROR);
        }
      },

      toggleFavorite: async (track) => {
        const isFavorite = Boolean(get().tracks[track.fileId]?.isFavorite);
        await get().setFavorite(track, !isFavorite);
      },

      markPlayed: (track) => {
        set((state) => {
          const existing = state.tracks[track.fileId];
          return {
            tracks: {
              ...state.tracks,
              [track.fileId]: {
                ...toLibraryMeta(existing, track),
                lastPlayedAt: Date.now(),
                playCount: (existing?.playCount ?? 0) + 1,
              },
            },
          };
        });
      },

      removeFromRecent: (fileId) => {
        set((state) => {
          const existing = state.tracks[fileId];
          if (!existing?.lastPlayedAt) return state;

          const nextTrack = pruneTrack({
            ...existing,
            lastPlayedAt: undefined,
          });

          if (!nextTrack) {
            const { [fileId]: _removed, ...remaining } = state.tracks;
            return { tracks: remaining };
          }

          return {
            tracks: {
              ...state.tracks,
              [fileId]: nextTrack,
            },
          };
        });
      },

      clearRecent: () => {
        set((state) => ({
          tracks: Object.fromEntries(
            Object.entries(state.tracks)
              .map(([fileId, track]) => [
                fileId,
                pruneTrack({
                  ...track,
                  lastPlayedAt: undefined,
                }),
              ])
              .filter(([, track]) => Boolean(track)),
          ),
        }));
      },

      replaceFavoritesFromCloud: (favorites) => {
        set((state) => {
          const nextTracks: Record<string, TrackLibraryMeta> = {};

          for (const [fileId, track] of Object.entries(state.tracks)) {
            const nextTrack = pruneTrack({
              ...track,
              isFavorite: false,
            });

            if (nextTrack) {
              nextTracks[fileId] = nextTrack;
            }
          }

          for (const favorite of favorites) {
            const existing =
              nextTracks[favorite.fileId] ?? state.tracks[favorite.fileId];
            nextTracks[favorite.fileId] = {
              ...toLibraryMeta(existing, favorite),
              isFavorite: true,
            };
          }

          return {
            tracks: nextTracks,
            isCloudHydrated: true,
            isCloudSyncing: false,
          };
        });
      },

      syncFavoritesFromCloud: async () => {
        set({ isCloudSyncing: true });
        try {
          const data = await fetchCloudLibrarySync();
          get().replaceFavoritesFromCloud(data.favorites);
        } finally {
          set({ isCloudSyncing: false });
        }
      },

      clearCloudFavorites: () => {
        set((state) => {
          const tracks = Object.fromEntries(
            Object.entries(state.tracks)
              .map(([fileId, track]) => [
                fileId,
                pruneTrack({
                  ...track,
                  isFavorite: false,
                }),
              ])
              .filter(([, track]) => Boolean(track)),
          );

          return {
            tracks,
            isCloudHydrated: false,
            isCloudSyncing: false,
          };
        });
      },

      clearAll: () => {
        set({
          tracks: {},
          isCloudHydrated: false,
          isCloudSyncing: false,
        });
      },
    }),
    {
      name: "drivebeats-library",
      partialize: (state) => ({
        tracks: state.tracks,
      }),
    },
  ),
);
