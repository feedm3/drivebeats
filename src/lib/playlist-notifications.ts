import { toast } from "sonner";
import type { AddPlaylistTracksResult } from "@/lib/cloud-library-shared";
import { MAX_TRACKS_PER_PLAYLIST } from "@/lib/playlist-limits";

export function notifyPlaylistTrackAddResult(
  playlistName: string,
  result: AddPlaylistTracksResult,
) {
  if (result.addedCount > 0) {
    toast.success(
      `Added ${result.addedCount} track${result.addedCount > 1 ? "s" : ""} to ${playlistName}`,
    );
  }

  if (result.duplicateCount > 0) {
    toast.info(
      `${result.duplicateCount} track${result.duplicateCount > 1 ? "s are" : " is"} already in ${playlistName}`,
    );
  }

  if (result.skippedCount > 0 && result.reachedTrackLimit) {
    toast.warning(
      `${playlistName} is full. ${result.skippedCount} track${result.skippedCount > 1 ? "s were" : " was"} not added.`,
    );
  }
}

export function notifyPlaylistCreatedWithTracks(
  playlistName: string,
  result: AddPlaylistTracksResult,
) {
  if (result.addedCount > 0) {
    toast.success(
      `Created "${playlistName}" with ${result.addedCount} track${result.addedCount > 1 ? "s" : ""}`,
    );
  } else {
    toast.success(`Created "${playlistName}"`);
  }

  if (result.skippedCount > 0 && result.reachedTrackLimit) {
    toast.warning(
      `"${playlistName}" reached the ${MAX_TRACKS_PER_PLAYLIST}-song limit. ${result.skippedCount} track${result.skippedCount > 1 ? "s were" : " was"} not added.`,
    );
  }
}

export function shouldClosePlaylistPicker(result: AddPlaylistTracksResult) {
  return (
    result.addedCount > 0 ||
    (result.duplicateCount > 0 && result.skippedCount === 0)
  );
}
