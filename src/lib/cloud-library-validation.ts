import type {
  AddPlaylistTracksInput,
  CloudLibrarySyncPayload,
  CreatePlaylistInput,
  FavoriteTrackInput,
  ReorderPlaylistTracksInput,
} from "@/lib/cloud-library-shared";
import type { Playlist, PlaylistTrack } from "@/types";

export const MAX_BOOTSTRAP_PLAYLISTS = 1_000;
export const MAX_BOOTSTRAP_FAVORITES = 10_000;
export const MAX_TRACKS_PER_PLAYLIST = 10_000;
export const MAX_TRACKS_PER_MUTATION = 1_000;
export const MAX_REORDER_FILE_IDS = 10_000;
export const MAX_GOOGLE_ID_LENGTH = 512;
export const MAX_TEXT_NAME_LENGTH = 500;
export const MAX_MIME_TYPE_LENGTH = 255;
export const MAX_SIZE_LENGTH = 64;
export const MAX_MODIFIED_TIME_LENGTH = 64;
export const MAX_PARENTS_PER_TRACK = 32;
export const MAX_URL_LENGTH = 2_048;
export const MAX_EMAIL_LENGTH = 320;

function isNonEmptyString(value: unknown, maxLength: number) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

function isOptionalString(value: unknown, maxLength: number) {
  return (
    value == null || (typeof value === "string" && value.length <= maxLength)
  );
}

function isParentsArray(value: unknown) {
  return (
    value == null ||
    (Array.isArray(value) &&
      value.length <= MAX_PARENTS_PER_TRACK &&
      value.every((parentId) =>
        isNonEmptyString(parentId, MAX_GOOGLE_ID_LENGTH),
      ))
  );
}

export function isValidPlaylistTrack(value: unknown): value is PlaylistTrack {
  if (!value || typeof value !== "object") {
    return false;
  }

  const track = value as Partial<PlaylistTrack>;
  return (
    isNonEmptyString(track.fileId, MAX_GOOGLE_ID_LENGTH) &&
    isNonEmptyString(track.fileName, MAX_TEXT_NAME_LENGTH) &&
    isOptionalString(track.mimeType, MAX_MIME_TYPE_LENGTH) &&
    isOptionalString(track.size, MAX_SIZE_LENGTH) &&
    isOptionalString(track.modifiedTime, MAX_MODIFIED_TIME_LENGTH) &&
    isParentsArray(track.parents) &&
    isOptionalString(track.parentFolderName, MAX_TEXT_NAME_LENGTH)
  );
}

export function isValidPlaylist(value: unknown): value is Playlist {
  if (!value || typeof value !== "object") {
    return false;
  }

  const playlist = value as Partial<Playlist>;
  return (
    isNonEmptyString(playlist.id, MAX_GOOGLE_ID_LENGTH) &&
    isNonEmptyString(playlist.name, MAX_TEXT_NAME_LENGTH) &&
    Array.isArray(playlist.tracks) &&
    playlist.tracks.length <= MAX_TRACKS_PER_PLAYLIST &&
    playlist.tracks.every(isValidPlaylistTrack)
  );
}

export function parseBootstrapPayload(
  body: Partial<CloudLibrarySyncPayload> | null,
) {
  if (!body) {
    return null;
  }

  if (
    !Array.isArray(body.playlists) ||
    !Array.isArray(body.favorites) ||
    body.playlists.length > MAX_BOOTSTRAP_PLAYLISTS ||
    body.favorites.length > MAX_BOOTSTRAP_FAVORITES ||
    !body.playlists.every(isValidPlaylist) ||
    !body.favorites.every(isValidPlaylistTrack)
  ) {
    return null;
  }

  return {
    playlists: body.playlists,
    favorites: body.favorites,
  } satisfies CloudLibrarySyncPayload;
}

export function parseCreatePlaylistInput(
  body: Partial<CreatePlaylistInput> | null,
): CreatePlaylistInput | null {
  const id = body?.id;
  const rawName = body?.name;

  if (
    typeof id !== "string" ||
    typeof rawName !== "string" ||
    !isNonEmptyString(id, MAX_GOOGLE_ID_LENGTH)
  ) {
    return null;
  }

  const name = rawName.trim();
  if (!isNonEmptyString(name, MAX_TEXT_NAME_LENGTH)) {
    return null;
  }

  return {
    id,
    name,
  } satisfies CreatePlaylistInput;
}

export function parsePlaylistNameInput(
  body: Partial<{ name: string }> | null,
): { name: string } | null {
  const rawName = body?.name;
  if (typeof rawName !== "string") {
    return null;
  }

  const name = rawName.trim();
  if (!isNonEmptyString(name, MAX_TEXT_NAME_LENGTH)) {
    return null;
  }

  return {
    name,
  } satisfies { name: string };
}

export function parseAddPlaylistTracksInput(
  body: Partial<AddPlaylistTracksInput> | null,
) {
  if (
    !body ||
    !Array.isArray(body.tracks) ||
    body.tracks.length > MAX_TRACKS_PER_MUTATION ||
    !body.tracks.every(isValidPlaylistTrack)
  ) {
    return null;
  }

  return body as AddPlaylistTracksInput;
}

export function parseReorderPlaylistTracksInput(
  body: Partial<ReorderPlaylistTracksInput> | null,
) {
  if (
    !body ||
    !Array.isArray(body.fileIds) ||
    body.fileIds.length === 0 ||
    body.fileIds.length > MAX_REORDER_FILE_IDS ||
    body.fileIds.some(
      (fileId) => !isNonEmptyString(fileId, MAX_GOOGLE_ID_LENGTH),
    )
  ) {
    return null;
  }

  if (new Set(body.fileIds).size !== body.fileIds.length) {
    return null;
  }

  return body as ReorderPlaylistTracksInput;
}

export function parseFavoriteTrackInput(
  body: Partial<FavoriteTrackInput> | null,
  fileId: string,
) {
  const track = body?.track;
  if (!track || !isValidPlaylistTrack(track) || track.fileId !== fileId) {
    return null;
  }

  return { track } satisfies FavoriteTrackInput;
}
