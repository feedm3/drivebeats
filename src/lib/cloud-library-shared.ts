import type { Playlist, PlaylistTrack } from "@/types";

export interface CloudLibrarySyncPayload {
  playlists: Playlist[];
  favorites: PlaylistTrack[];
}

export interface CreatePlaylistInput {
  id: string;
  name: string;
}

export interface AddPlaylistTracksInput {
  tracks: PlaylistTrack[];
}

export interface ReorderPlaylistTracksInput {
  fileIds: string[];
}

export interface FavoriteTrackInput {
  track: PlaylistTrack;
}
