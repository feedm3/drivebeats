import { SUPPORTED_AUDIO_MIME_TYPES } from "@/lib/audio";
import {
  GoogleDriveReadError,
  LibraryIncompleteError,
} from "@/lib/drive-read-error";
import type { DriveRequestOptions } from "@/lib/drive-request-scheduler";
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
  options?: DriveRequestOptions,
) => Promise<Response>;

export interface LibrarySearchBuildPage {
  phase: "audio" | "folders";
  files: DriveFile[];
}

export interface LibrarySearchBuildCheckpoint {
  startedAt: number;
  listingComplete?: boolean;
  audioFiles: DriveFile[];
  folders: DriveFile[];
  phase: "audio" | "folders";
  pageToken?: string;
}

interface BuildLibrarySearchCatalogFromDriveInput {
  accessToken: string;
  importedFolders: DriveFile[];
  standaloneTracks: DriveFile[];
  listFiles?: DriveListFiles;
  signal?: AbortSignal;
  requestOptions?: DriveRequestOptions;
  checkpoint?: LibrarySearchBuildCheckpoint;
  startedAt?: number;
  onCheckpoint?: (
    checkpoint: LibrarySearchBuildCheckpoint,
    page?: LibrarySearchBuildPage,
  ) => void | Promise<void>;
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
  requestOptions?: DriveRequestOptions,
  existingFiles: DriveFile[] = [],
  initialPageToken?: string,
  onPage?: (
    files: DriveFile[],
    nextPageToken: string | undefined,
    page: DriveFile[],
  ) => void | Promise<void>,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [...existingFiles];
  let pageToken: string | undefined = initialPageToken;

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

    const response = await listFiles(
      accessToken,
      params,
      signal,
      requestOptions,
    );
    abortIfNeeded(signal);
    if (!response.ok) {
      throw new GoogleDriveReadError(
        response.headers.get("X-DriveBeats-Rate-Limited") === "true"
          ? 429
          : response.status,
      );
    }

    const data = (await response.json()) as GoogleDriveFilesListResponse;
    abortIfNeeded(signal);
    if (data.incompleteSearch) {
      throw new LibraryIncompleteError();
    }

    const page = data.files ?? [];
    files.push(...page);
    pageToken = data.nextPageToken;
    await onPage?.(files, pageToken, page);
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
  requestOptions,
  checkpoint,
  startedAt = checkpoint?.startedAt ?? Date.now(),
  onCheckpoint,
}: BuildLibrarySearchCatalogFromDriveInput): Promise<LibrarySearchTrack[]> {
  abortIfNeeded(signal);
  if (checkpoint?.listingComplete)
    return buildLibrarySearchCatalog({
      audioFiles: checkpoint.audioFiles,
      folders: checkpoint.folders,
      importedFolders,
      standaloneTracks,
    });

  const audioFiles =
    checkpoint?.phase === "folders"
      ? checkpoint.audioFiles
      : await listEveryPage(
          accessToken,
          supportedAudioQuery(),
          listFiles,
          signal,
          requestOptions,
          checkpoint?.audioFiles,
          checkpoint?.pageToken,
          (files, pageToken, page) =>
            onCheckpoint?.(
              {
                startedAt,
                audioFiles: files,
                folders: [],
                phase: pageToken ? "audio" : "folders",
                pageToken,
              },
              { phase: "audio", files: page },
            ),
        );
  abortIfNeeded(signal);
  const folders = await listEveryPage(
    accessToken,
    `trashed = false and mimeType = '${FOLDER_MIME}'`,
    listFiles,
    signal,
    requestOptions,
    checkpoint?.phase === "folders" ? checkpoint.folders : [],
    checkpoint?.phase === "folders" ? checkpoint.pageToken : undefined,
    (files, pageToken, page) =>
      onCheckpoint?.(
        {
          startedAt,
          listingComplete: !pageToken,
          audioFiles,
          folders: files,
          phase: "folders",
          pageToken,
        },
        { phase: "folders", files: page },
      ),
  );

  abortIfNeeded(signal);
  return buildLibrarySearchCatalog({
    audioFiles,
    folders,
    importedFolders,
    standaloneTracks,
  });
}
