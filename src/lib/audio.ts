import type { DriveFile, PlaylistTrack } from "@/types";

const AUDIO_EXTENSION_TO_MIME: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
};

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/x-flac",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "audio/ogg",
] as const;

export function inferAudioMimeType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (!extension) return undefined;
  return AUDIO_EXTENSION_TO_MIME[extension];
}

export function isSupportedAudioFile(
  file: Pick<DriveFile, "mimeType" | "name">,
) {
  return (
    SUPPORTED_AUDIO_MIME_TYPES.includes(
      file.mimeType as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number],
    ) || inferAudioMimeType(file.name) != null
  );
}

export function createPlaylistTrack(file: DriveFile): PlaylistTrack {
  return {
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    size: file.size,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
    parentFolderName: file.parentFolderName,
  };
}

export function playlistTrackToDriveFile(track: PlaylistTrack): DriveFile {
  return {
    id: track.fileId,
    name: track.fileName,
    mimeType:
      track.mimeType ?? inferAudioMimeType(track.fileName) ?? "audio/mpeg",
    size: track.size,
    modifiedTime: track.modifiedTime,
    parents: track.parents,
    parentFolderName: track.parentFolderName,
  };
}

export function getTrackDisplayName(name: string) {
  return name.replace(/\.(mp3|flac|wav|m4a|aac|ogg)$/i, "");
}

export function getSupportedAudioQuery(folderId: string) {
  const mimeClauses = SUPPORTED_AUDIO_MIME_TYPES.map(
    (mimeType) => `mimeType = '${mimeType}'`,
  ).join(" or ");

  return `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or ${mimeClauses})`;
}
