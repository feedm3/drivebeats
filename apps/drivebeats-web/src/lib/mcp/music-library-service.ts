import { inferAudioMimeType, isSupportedAudioFile } from "@/lib/audio";
import { GOOGLE_APIS } from "@/lib/google-api";
import type { DriveFile, PlaylistTrack } from "@/types";
import {
  getMcpGoogleAccessToken,
  McpAuthError,
  type McpPrincipal,
} from "./auth";
import { getMcpMusicSession } from "./music-session-service";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const FIELDS = "id,name,mimeType,parents,size,modifiedTime,trashed";

export class McpLibraryError extends Error {}

export function requireDriveFileId(fileId: string) {
  if (!FILE_ID.test(fileId))
    throw new McpLibraryError("Invalid Library item ID.");
}

function parseFile(value: unknown): DriveFile {
  if (!value || typeof value !== "object")
    throw new McpLibraryError("Library item is unavailable.");
  const file = value as Record<string, unknown>;
  if (
    typeof file.id !== "string" ||
    !FILE_ID.test(file.id) ||
    typeof file.name !== "string" ||
    !file.name ||
    file.name.length > 500 ||
    typeof file.mimeType !== "string" ||
    file.mimeType.length > 255 ||
    file.trashed === true ||
    (file.parents !== undefined &&
      (!Array.isArray(file.parents) ||
        file.parents.length > 32 ||
        file.parents.some((id) => typeof id !== "string" || !FILE_ID.test(id))))
  )
    throw new McpLibraryError("Library item is unavailable.");
  return {
    id: file.id,
    name: file.name,
    mimeType:
      file.mimeType === FOLDER_MIME
        ? FOLDER_MIME
        : (inferAudioMimeType(file.name) ?? file.mimeType),
    parents: file.parents as string[] | undefined,
    size:
      typeof file.size === "string" && file.size.length <= 64
        ? file.size
        : undefined,
    modifiedTime:
      typeof file.modifiedTime === "string" && file.modifiedTime.length <= 64
        ? file.modifiedTime
        : undefined,
  };
}

async function providerRead(url: URL, accessToken: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.warn("[DEBUG-drivebeats-media] library", {
      status: response.status,
    });
    throw new McpLibraryError(
      "Library item is unavailable. Reconnect or import an accessible item.",
    );
  }
  return response.json();
}

async function metadata(fileId: string, accessToken: string) {
  requireDriveFileId(fileId);
  const url = new URL(
    `${GOOGLE_APIS.driveFilesUrl}/${encodeURIComponent(fileId)}`,
  );
  url.search = new URLSearchParams({
    fields: FIELDS,
    supportsAllDrives: "true",
  }).toString();
  const file = parseFile(await providerRead(url, accessToken));
  if (file.id !== fileId)
    throw new McpLibraryError("Library item is unavailable.");
  return file;
}

async function scopedItem(
  principal: McpPrincipal,
  sessionId: string,
  fileId: string,
  accessToken: string,
  scope?: {
    session: Awaited<ReturnType<typeof getMcpMusicSession>>;
    metadata: (id: string) => Promise<DriveFile>;
  },
) {
  if (principal.profile.id !== principal.googleUserId) throw new McpAuthError();
  const session =
    scope?.session ?? (await getMcpMusicSession(principal, sessionId));
  const readMetadata =
    scope?.metadata ?? ((id: string) => metadata(id, accessToken));
  const file = await readMetadata(fileId);
  const roots = new Set(session.importedFolderIds);
  if (
    roots.has(file.id) ||
    (file.mimeType !== FOLDER_MIME &&
      session.standaloneTrackIds.includes(file.id))
  )
    return file;
  const pending = [...(file.parents ?? [])];
  const visited = new Set<string>([file.id]);
  // Drive ancestry is provider-verified, never taken from a tool's input or UI search result.
  while (pending.length && visited.size < 128) {
    const parentId = pending.shift();
    if (!parentId || visited.has(parentId)) continue;
    if (roots.has(parentId)) return file;
    visited.add(parentId);
    const parent = await readMetadata(parentId);
    if (parent.mimeType !== FOLDER_MIME) continue;
    pending.push(...(parent.parents ?? []));
  }
  throw new McpLibraryError(
    "This item is outside the session's imported Library.",
  );
}

export async function readMcpLibraryItem(
  principal: McpPrincipal,
  sessionId: string,
  fileId: string,
) {
  requireDriveFileId(fileId);
  if (principal.profile.id !== principal.googleUserId) throw new McpAuthError();
  const session = await getMcpMusicSession(principal, sessionId);
  const accessToken = await getMcpGoogleAccessToken(principal);
  const file = await scopedItem(principal, sessionId, fileId, accessToken, {
    session,
    metadata: (id) => metadata(id, accessToken),
  });
  if (file.mimeType !== FOLDER_MIME && !isSupportedAudioFile(file))
    throw new McpLibraryError(
      "This item is not a supported Playable Track or folder.",
    );
  return file;
}

export async function validateImportedTrack(
  principal: McpPrincipal,
  sessionId: string,
  fileId: string,
): Promise<PlaylistTrack> {
  const file = await readMcpLibraryItem(principal, sessionId, fileId);
  return toVerifiedTrack(file);
}

function toVerifiedTrack(file: DriveFile): PlaylistTrack {
  if (file.mimeType === FOLDER_MIME || !isSupportedAudioFile(file))
    throw new McpLibraryError("This item is not a supported Playable Track.");
  return {
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    size: file.size,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
  };
}

export async function validateImportedTracks(
  principal: McpPrincipal,
  sessionId: string,
  fileIds: string[],
) {
  const uniqueIds = [...new Set(fileIds)];
  if (uniqueIds.length > 500)
    throw new McpLibraryError("Too many Playable Tracks in one request.");
  if (principal.profile.id !== principal.googleUserId) throw new McpAuthError();
  for (const id of uniqueIds) requireDriveFileId(id);
  const session = await getMcpMusicSession(principal, sessionId);
  const accessToken = await getMcpGoogleAccessToken(principal);
  const cache = new Map<string, Promise<DriveFile>>();
  const scope = {
    session,
    metadata: (id: string) => {
      let value = cache.get(id);
      if (!value) {
        value = metadata(id, accessToken);
        cache.set(id, value);
      }
      return value;
    },
  };
  const tracks: PlaylistTrack[] = [];
  // Bound provider concurrency and reuse the credential and ancestor reads for
  // this operation, rather than refreshing Google's token for every track.
  for (let offset = 0; offset < uniqueIds.length; offset += 4) {
    tracks.push(
      ...(await Promise.all(
        uniqueIds
          .slice(offset, offset + 4)
          .map(async (id) =>
            toVerifiedTrack(
              await scopedItem(principal, sessionId, id, accessToken, scope),
            ),
          ),
      )),
    );
  }
  return tracks;
}

export async function readMcpLibraryFolder(
  principal: McpPrincipal,
  sessionId: string,
  folderId: string,
  pageToken?: string,
) {
  requireDriveFileId(folderId);
  if (principal.profile.id !== principal.googleUserId) throw new McpAuthError();
  const session = await getMcpMusicSession(principal, sessionId);
  const accessToken = await getMcpGoogleAccessToken(principal);
  const folder = await scopedItem(principal, sessionId, folderId, accessToken, {
    session,
    metadata: (id) => metadata(id, accessToken),
  });
  if (folder.mimeType !== FOLDER_MIME)
    throw new McpLibraryError("Choose an Imported Folder.");
  const url = new URL(GOOGLE_APIS.driveFilesUrl);
  url.search = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: `files(${FIELDS}),nextPageToken,incompleteSearch`,
    pageSize: "200",
    orderBy: "folder,name",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    ...(pageToken ? { pageToken } : {}),
  }).toString();
  const result = (await providerRead(url, accessToken)) as {
    files?: unknown[];
    nextPageToken?: unknown;
    incompleteSearch?: boolean;
  };
  if (
    !Array.isArray(result.files) ||
    result.files.length > 200 ||
    result.incompleteSearch
  )
    throw new McpLibraryError("Folder listing is incomplete. Try again.");
  const files = result.files
    .map(parseFile)
    .filter(
      (file) =>
        (file.parents ?? []).includes(folderId) &&
        (file.mimeType === FOLDER_MIME || isSupportedAudioFile(file)),
    );
  return {
    files,
    ...(typeof result.nextPageToken === "string"
      ? { nextPageToken: result.nextPageToken }
      : {}),
  };
}
