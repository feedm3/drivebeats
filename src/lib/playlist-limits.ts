// Keep the limit codes aligned with db/migrations/0005_playlist_limits.sql.
export const MAX_PLAYLISTS_PER_USER = 10;
export const MAX_TRACKS_PER_PLAYLIST = 500;

export const PLAYLIST_COUNT_LIMIT_CODE = "PLAYLIST_COUNT_LIMIT";
export const PLAYLIST_TRACK_LIMIT_CODE = "PLAYLIST_TRACK_LIMIT";

export const PLAYLIST_COUNT_LIMIT_ERROR =
  "You can only have up to 10 playlists.";
export const PLAYLIST_TRACK_LIMIT_ERROR =
  "This playlist has reached the 500-song limit.";

export type PlaylistLimitErrorCode =
  | typeof PLAYLIST_COUNT_LIMIT_CODE
  | typeof PLAYLIST_TRACK_LIMIT_CODE;

const PLAYLIST_LIMIT_MESSAGES: Record<PlaylistLimitErrorCode, string> = {
  [PLAYLIST_COUNT_LIMIT_CODE]: PLAYLIST_COUNT_LIMIT_ERROR,
  [PLAYLIST_TRACK_LIMIT_CODE]: PLAYLIST_TRACK_LIMIT_ERROR,
};

export class PlaylistLimitError extends Error {
  code: PlaylistLimitErrorCode;

  constructor(code: PlaylistLimitErrorCode) {
    super(PLAYLIST_LIMIT_MESSAGES[code]);
    this.name = "PlaylistLimitError";
    this.code = code;
  }
}

export function hasReachedPlaylistCountLimit(playlistCount: number) {
  return playlistCount >= MAX_PLAYLISTS_PER_USER;
}

export function isPlaylistFull(trackCount: number) {
  return trackCount >= MAX_TRACKS_PER_PLAYLIST;
}

export function getRemainingPlaylistTrackSlots(trackCount: number) {
  return Math.max(0, MAX_TRACKS_PER_PLAYLIST - trackCount);
}

export function getPlaylistLimitErrorMessage(code: PlaylistLimitErrorCode) {
  return PLAYLIST_LIMIT_MESSAGES[code];
}

export function getPlaylistLimitError(
  error: unknown,
): PlaylistLimitError | null {
  if (error instanceof PlaylistLimitError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === PLAYLIST_COUNT_LIMIT_CODE ||
      error.code === PLAYLIST_TRACK_LIMIT_CODE)
  ) {
    return new PlaylistLimitError(error.code);
  }

  if (
    error &&
    typeof error === "object" &&
    "detail" in error &&
    (error.detail === PLAYLIST_COUNT_LIMIT_CODE ||
      error.detail === PLAYLIST_TRACK_LIMIT_CODE)
  ) {
    return new PlaylistLimitError(error.detail);
  }

  return null;
}
