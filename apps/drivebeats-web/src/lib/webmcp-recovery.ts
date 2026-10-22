interface Recovery {
  action: string;
  message: string;
  automaticRetry: boolean;
  verificationTool?: string;
  retryAfterMs?: number;
  maxAttempts?: number;
}

/** Recovery is application data, not an extra browser API or tool. */
export function webMcpRecovery(
  code: string,
  readOnly: boolean,
  toolName?: string,
): Recovery {
  switch (code) {
    case "audio_user_interaction_required":
      return {
        action: "user_click_play",
        message:
          "Ask the user to tap Play in the DriveBeats player, then check playback status. Resume the prepared queue rather than submitting it again.",
        automaticRetry: false,
        verificationTool: "drivebeats_status",
      };
    case "sign_in_required":
    case "drive_auth_required":
      return {
        action: "sign_in",
        message: "Sign in to Google through the open DriveBeats page.",
        automaticRetry: false,
        verificationTool: "drivebeats_status",
      };
    case "drive_access_denied":
      return {
        action: "check_drive_access",
        message: "Check access to the selected music in Google Drive.",
        automaticRetry: false,
      };
    case "offline":
      return {
        action: "check_connection",
        message: "Restore the internet connection before trying again.",
        automaticRetry: false,
      };
    case "playback_timeout":
      return {
        action: "inspect_player",
        message:
          "Check playback status before retrying. If the track is still paused after loading finishes, tap Play in DriveBeats or resume the existing queue.",
        automaticRetry: false,
        verificationTool: "drivebeats_status",
      };
    case "library_indexing":
    case "playback_busy":
    case "sync_pending":
    case "drive_rate_limited":
    case "drive_busy":
      return {
        action: "wait",
        message: "Wait for the current operation or rate limit to settle.",
        automaticRetry: false,
        verificationTool: "drivebeats_status",
      };
    case "search_snapshot_expired":
    case "search_changed":
    case "snapshot_limit":
      return {
        action: "restart_search",
        message:
          "Start a new search without a cursor; narrow the query if there are too many matches.",
        automaticRetry: false,
      };
    case "network_error":
    case "drive_unavailable":
    case "library_unavailable":
    case "library_incomplete":
    case "sync_unavailable":
      return readOnly
        ? {
            action: "retry_read",
            message:
              "Temporary reads have already been retried internally. Retry this read once after a short wait; if it still fails, report the issue.",
            automaticRetry: true,
            retryAfterMs: 1000,
            maxAttempts: 1,
          }
        : {
            action: "inspect_state",
            message:
              "Check the page and connection before repeating a state-changing action. Read its current result first.",
            automaticRetry: false,
            verificationTool: "drivebeats_status",
          };
    case "sync_failed":
      return {
        action: "verify_collections",
        message:
          "Read the saved collections to check whether the change was applied before retrying." +
          (toolName === "drivebeats_save_playlist"
            ? " If creating a new Playlist, repeating creation can create duplicates."
            : ""),
        automaticRetry: false,
        verificationTool: "drivebeats_list_collections",
      };
    case "track_not_found":
    case "track_unavailable":
    case "unsupported_audio":
    case "empty_queue":
    case "no_current_track":
      return {
        action: "choose_track",
        message:
          "Choose a Playable Track from Library Search or a saved collection.",
        automaticRetry: false,
      };
    case "invalid_input":
    case "invalid_position":
      return {
        action: "correct_input",
        message:
          "Use the tool schema and the current playback duration to correct the arguments.",
        automaticRetry: false,
      };
    case "page_closed":
      return {
        action: "reopen_page",
        message: "Open DriveBeats and discover its current page tools again.",
        automaticRetry: false,
      };
    case "cancelled":
      return {
        action: "stop",
        message:
          "The action was cancelled. Check the current state before starting another action.",
        automaticRetry: false,
      };
    default:
      return {
        action: "inspect_state",
        message:
          "Check the current page state before choosing the next action.",
        automaticRetry: false,
        verificationTool: "drivebeats_status",
      };
  }
}
