import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlaylistTrack } from "@/types";

const MAX_RECENT_TRACKS = 50;

export interface TrackLibraryMeta extends PlaylistTrack {
  isFavorite?: boolean;
  lastPlayedAt?: number;
  playCount: number;
}

interface LibraryState {
  tracks: Record<string, TrackLibraryMeta>;
  setFavorite: (track: PlaylistTrack, isFavorite: boolean) => void;
  toggleFavorite: (track: PlaylistTrack) => void;
  markPlayed: (track: PlaylistTrack) => void;
  removeFromRecent: (fileId: string) => void;
  clearRecent: () => void;
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
    parentFolderName:
      track.parentFolderName ?? existing?.parentFolderName,
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
    (set) => ({
      tracks: {},

      setFavorite: (track, isFavorite) => {
        set((state) => {
          const existing = state.tracks[track.fileId];
          return {
            tracks: {
              ...state.tracks,
              [track.fileId]: {
                ...toLibraryMeta(existing, track),
                isFavorite,
              },
            },
          };
        });
      },

      toggleFavorite: (track) => {
        set((state) => {
          const existing = state.tracks[track.fileId];
          return {
            tracks: {
              ...state.tracks,
              [track.fileId]: {
                ...toLibraryMeta(existing, track),
                isFavorite: !existing?.isFavorite,
              },
            },
          };
        });
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

          return {
            tracks: {
              ...state.tracks,
              [fileId]: {
                ...existing,
                lastPlayedAt: undefined,
              },
            },
          };
        });
      },

      clearRecent: () => {
        set((state) => ({
          tracks: Object.fromEntries(
            Object.entries(state.tracks).map(([fileId, track]) => [
              fileId,
              {
                ...track,
                lastPlayedAt: undefined,
              },
            ]),
          ),
        }));
      },
    }),
    {
      name: "drivebeats-library",
    },
  ),
);
