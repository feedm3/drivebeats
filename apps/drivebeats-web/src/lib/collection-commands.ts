import type { CloudLibrarySyncPayload } from "@/lib/cloud-library-shared";
import {
  MAX_PLAYLISTS_PER_USER,
  MAX_TRACKS_PER_PLAYLIST,
  PLAYLIST_COUNT_LIMIT_CODE,
  PLAYLIST_TRACK_LIMIT_CODE,
  PlaylistLimitError,
} from "@/lib/playlist-limits";
import type { PlaylistTrack } from "@/types";

export class CollectionCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 403 | 404 | 409 | 422,
    readonly resumeOperationId?: string,
  ) {
    super(message);
    this.name = "CollectionCommandError";
  }
}

export type CollectionCommand =
  | { type: "create"; id: string; name: string; tracks: PlaylistTrack[] }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "add"; id: string; tracks: PlaylistTrack[] }
  | { type: "remove"; id: string; fileId: string }
  | { type: "reorder"; id: string; fileIds: string[] }
  | { type: "favorite"; track: PlaylistTrack; enabled: boolean };

export interface CollectionResult {
  trackCount?: number;
  addedCount?: number;
  duplicateCount?: number;
  skippedCount?: number;
  reachedTrackLimit?: boolean;
}

/** Apply user intent to the latest authoritative snapshot; never union stale snapshots. */
export function applyCollectionCommand(
  current: CloudLibrarySyncPayload,
  command: CollectionCommand,
) {
  const payload = structuredClone(current);
  let result: CollectionResult = {};
  if (command.type === "favorite") {
    payload.favorites = payload.favorites.filter(
      (track) => track.fileId !== command.track.fileId,
    );
    if (command.enabled) {
      if (payload.favorites.length >= 10_000)
        throw new CollectionCommandError(
          "appdata_favorite_limit",
          "Favorite limit reached",
          422,
        );
      payload.favorites.push(command.track);
    }
  } else if (command.type === "create") {
    if (payload.playlists.some((playlist) => playlist.id === command.id))
      throw new CollectionCommandError(
        "appdata_collection_exists",
        "Playlist already exists",
        422,
      );
    if (payload.playlists.length >= MAX_PLAYLISTS_PER_USER)
      throw new PlaylistLimitError(PLAYLIST_COUNT_LIMIT_CODE);
    const tracks = [
      ...new Map(command.tracks.map((track) => [track.fileId, track])).values(),
    ];
    if (tracks.length > MAX_TRACKS_PER_PLAYLIST)
      throw new PlaylistLimitError(PLAYLIST_TRACK_LIMIT_CODE);
    payload.playlists.push({ id: command.id, name: command.name, tracks });
    result = { trackCount: tracks.length };
  } else if (command.type === "delete") {
    payload.playlists = payload.playlists.filter(
      (playlist) => playlist.id !== command.id,
    );
  } else {
    const playlist = payload.playlists.find(
      (playlist) => playlist.id === command.id,
    );
    if (!playlist)
      throw new CollectionCommandError(
        "appdata_collection_not_found",
        "Playlist not found; refresh your Library",
        404,
      );
    switch (command.type) {
      case "rename":
        playlist.name = command.name;
        break;
      case "remove":
        playlist.tracks = playlist.tracks.filter(
          (track) => track.fileId !== command.fileId,
        );
        break;
      case "reorder": {
        const byId = new Map(
          playlist.tracks.map((track) => [track.fileId, track]),
        );
        if (
          command.fileIds.length !== byId.size ||
          new Set(command.fileIds).size !== byId.size ||
          command.fileIds.some((id) => !byId.has(id))
        )
          throw new CollectionCommandError(
            "appdata_collection_changed",
            "Playlist changed; refresh before reordering",
            422,
          );
        playlist.tracks = command.fileIds.map(
          (id) => byId.get(id) as PlaylistTrack,
        );
        break;
      }
      case "add": {
        const ids = new Set(playlist.tracks.map((track) => track.fileId));
        const unique: PlaylistTrack[] = [];
        for (const track of command.tracks) {
          if (!ids.has(track.fileId)) {
            ids.add(track.fileId);
            unique.push(track);
          }
        }
        const added = unique.slice(
          0,
          Math.max(0, MAX_TRACKS_PER_PLAYLIST - playlist.tracks.length),
        );
        playlist.tracks.push(...added);
        result = {
          addedCount: added.length,
          duplicateCount: command.tracks.length - unique.length,
          skippedCount: unique.length - added.length,
          reachedTrackLimit: playlist.tracks.length >= MAX_TRACKS_PER_PLAYLIST,
        };
        break;
      }
    }
  }
  return { payload, result };
}
