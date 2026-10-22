import {
  GoogleDriveReadError,
  getDriveReadFailure,
} from "@/lib/drive-read-error";

export type PlaybackFailureCode =
  | "audio_user_interaction_required"
  | "unsupported_audio"
  | "drive_auth_required"
  | "drive_access_denied"
  | "track_unavailable"
  | "drive_rate_limited"
  | "drive_busy"
  | "drive_unavailable"
  | "network_error"
  | "playback_timeout"
  | "playback_failed";

export interface PlaybackFailure {
  code: PlaybackFailureCode;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

const messages: Record<PlaybackFailureCode, string> = {
  audio_user_interaction_required:
    "Tap Play in DriveBeats once to allow audio in this browser, then try again.",
  unsupported_audio:
    "This browser cannot play the selected audio file. Try another track or browser.",
  drive_auth_required: "Sign in to DriveBeats again to access this track.",
  drive_access_denied:
    "Google Drive denied access to this track. Check its permissions in DriveBeats.",
  track_unavailable:
    "The selected track is no longer available in Google Drive.",
  drive_rate_limited:
    "Google Drive is receiving too many requests. Wait a moment, then try again.",
  drive_busy: "DriveBeats is busy. Try again shortly.",
  drive_unavailable:
    "Google Drive could not provide the selected track. Try again shortly.",
  network_error:
    "The track could not be downloaded. Check your connection and try again.",
  playback_timeout:
    "Audio did not start in time. Check the player in DriveBeats and wait a moment before trying again.",
  playback_failed:
    "The selected track could not be played. Try again in DriveBeats.",
};

export class PlaybackError extends Error {
  constructor(public readonly code: PlaybackFailureCode) {
    super(messages[code]);
    this.name = "PlaybackError";
  }
}

export function getPlaybackFailure(error: unknown): PlaybackFailure | null {
  const name =
    error && typeof error === "object" && "name" in error
      ? error.name
      : undefined;
  if (name === "AbortError") return null;
  const driveFailure = getDriveReadFailure(error);
  if (driveFailure) return driveFailure;
  let code: PlaybackFailureCode = "playback_failed";
  if (error instanceof PlaybackError) code = error.code;
  else if (error instanceof GoogleDriveReadError) {
    code =
      error.status === 401
        ? "drive_auth_required"
        : error.status === 403
          ? "drive_access_denied"
          : error.status === 404
            ? "track_unavailable"
            : error.status === 429
              ? "drive_rate_limited"
              : "drive_unavailable";
  } else {
    if (name === "NotAllowedError") code = "audio_user_interaction_required";
    else if (name === "NotSupportedError") code = "unsupported_audio";
    else if (name === "TimeoutError") code = "playback_timeout";
    else if (name === "NetworkError") code = "network_error";
  }
  return { code, message: messages[code] };
}
