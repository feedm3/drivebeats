import { SUPPORTED_AUDIO_MIME_TYPES } from "@/lib/audio";
import {
  type GoogleDriveFilesListResponse,
  listGoogleDriveFiles,
} from "@/lib/google-api";
import {
  buildLibrarySearchCatalog,
  type LibrarySearchTrack,
} from "@/lib/library-search-catalog";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

type DriveListFiles = (
  accessToken: string,
  params: URLSearchParams,
  signal?: AbortSignal,
) => Promise<Response>;

interface BuildLibrarySearchCatalogFromDriveInput {
  accessToken: string;
  importedFolders: DriveFile[];
  standaloneTracks: DriveFile[];
  listFiles?: DriveListFiles;
  signal?: AbortSignal;
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException(
      "Library Search refresh was cancelled",
      "AbortError",
    );
  }
}

async function listEveryPage(
  accessToken: string,
  query: string,
  listFiles: DriveListFiles,
  signal?: AbortSignal,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    abortIfNeeded(signal);
    const params = new URLSearchParams({
      q: query,
      fields:
        "incompleteSearch,nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)",
      pageSize: "1000",
      spaces: "drive",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await listFiles(accessToken, params, signal);
    abortIfNeeded(signal);
    if (!response.ok) {
      throw new Error(
        `Drive Library Search request failed (${response.status})`,
      );
    }

    const data = (await response.json()) as GoogleDriveFilesListResponse;
    abortIfNeeded(signal);
    if (data.incompleteSearch) {
      throw new Error("Google Drive returned an incomplete Library Search");
    }

    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

function supportedAudioQuery() {
  const mimeClauses = SUPPORTED_AUDIO_MIME_TYPES.map(
    (mimeType) => `mimeType = '${mimeType}'`,
  ).join(" or ");
  return `trashed = false and (${mimeClauses})`;
}

export async function buildLibrarySearchCatalogFromDrive({
  accessToken,
  importedFolders,
  standaloneTracks,
  listFiles = listGoogleDriveFiles,
  signal,
}: BuildLibrarySearchCatalogFromDriveInput): Promise<LibrarySearchTrack[]> {
  abortIfNeeded(signal);

  const [audioFiles, folders] = await Promise.all([
    listEveryPage(accessToken, supportedAudioQuery(), listFiles, signal),
    listEveryPage(
      accessToken,
      `trashed = false and mimeType = '${FOLDER_MIME}'`,
      listFiles,
      signal,
    ),
  ]);

  abortIfNeeded(signal);
  return buildLibrarySearchCatalog({
    audioFiles,
    folders,
    importedFolders,
    standaloneTracks,
  });
}
