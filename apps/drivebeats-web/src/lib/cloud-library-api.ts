"use client";

import type {
  AddPlaylistTracksInput,
  AddPlaylistTracksResult,
  CloudLibrarySyncPayload,
  CreatePlaylistInput,
  FavoriteTrackInput,
  ReorderPlaylistTracksInput,
} from "@/lib/cloud-library-shared";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";
import type { Playlist, PlaylistTrack } from "@/types";

const CLOUD_API_TIMEOUT_MS = 30_000;
const COLLECTION_JOURNAL_LOCK = "drivebeats-collection-journal-v1";

async function writeCollectionJournal<T>(action: () => T) {
  if (typeof navigator.locks?.request !== "function")
    throw new Error("Update your browser to safely save collection changes.");
  return navigator.locks.request(COLLECTION_JOURNAL_LOCK, action);
}

export async function clearPendingCollectionSaves() {
  const clear = () => {
    for (const key of Object.keys(window.localStorage))
      if (key.startsWith("drivebeats-collection-outbox-v1:"))
        window.localStorage.removeItem(key);
  };
  if (typeof navigator.locks?.request === "function")
    await writeCollectionJournal(clear);
  else clear();
}

const removeCollectionSave = (key: string) =>
  writeCollectionJournal(() => window.localStorage.removeItem(key));

export function getPendingCollectionSaveCount(
  accountId = useDriveAppDataStore.getState().accountId,
  generation = useDriveAppDataStore.getState().generation,
) {
  if (!accountId || !generation) return 0;
  const prefix = `drivebeats-collection-outbox-v1:${accountId}:${generation}:`;
  return Object.keys(window.localStorage).filter((key) =>
    key.startsWith(prefix),
  ).length;
}

class CloudApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "CloudApiError";
    this.code = code;
  }
}

async function readError(response: Response) {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
    resumeOperationId?: string;
  } | null;

  if (data?.error) {
    return {
      message: data.error,
      code: data.code,
      resumeOperationId: data.resumeOperationId,
    };
  }

  return {
    message: `${response.status} ${response.statusText}`.trim(),
  };
}

async function advanceCollectionSave(
  key: string,
  expectedId: string,
  generation: string,
  successor: unknown,
) {
  if (
    typeof successor !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(successor)
  )
    return;
  await writeCollectionJournal(() => {
    const current = JSON.parse(window.localStorage.getItem(key) ?? "null");
    // A late response must not recreate a logged-out queue or move a peer's
    // already-advanced receipt backwards.
    if (
      current?.operationId !== expectedId ||
      current.generation !== generation
    )
      return;
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...current, operationId: successor }),
    );
  });
}

async function request(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const identity = useDriveAppDataStore.getState();
  const mutation =
    init?.method &&
    init.method !== "GET" &&
    input !== "/api/appdata/reset" &&
    input !== "/api/me/cloud-data" &&
    input !== "/api/sync/bootstrap";
  const operationId = mutation ? crypto.randomUUID() : null;
  const outboxKey =
    operationId && identity.accountId && identity.generation
      ? `drivebeats-collection-outbox-v1:${identity.accountId}:${identity.generation}:${operationId}`
      : null;
  if (mutation && !outboxKey)
    throw new Error(
      "Prepare your Google Drive backup before changing collections",
    );
  if (outboxKey)
    await writeCollectionJournal(() => {
      if (
        useDriveAppDataStore.getState().accountId !== identity.accountId ||
        useDriveAppDataStore.getState().generation !== identity.generation
      )
        throw new Error("Account changed before the collection save");
      window.localStorage.setItem(
        outboxKey,
        JSON.stringify({
          input,
          method: init?.method,
          body: init?.body,
          operationId,
          generation: identity.generation,
        }),
      );
    });
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CLOUD_API_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(input, {
      cache: "no-store",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(identity.generation
          ? { "X-DriveBeats-Generation": identity.generation }
          : {}),
        ...(init?.headers ?? {}),
        ...(operationId ? { "X-DriveBeats-Operation": operationId } : {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Request timed out");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    // Definitively rejected operations never entered the durable server queue.
    if (outboxKey && [400, 401, 403, 404, 422].includes(response.status))
      await removeCollectionSave(outboxKey);
    const { message, code, resumeOperationId } = await readError(response);
    if (
      outboxKey &&
      operationId &&
      identity.generation &&
      response.status === 409
    )
      await advanceCollectionSave(
        outboxKey,
        operationId,
        identity.generation,
        resumeOperationId,
      );
    throw new CloudApiError(message, code);
  }

  if (outboxKey) await removeCollectionSave(outboxKey);

  return response;
}

export async function fetchCloudLibrarySync() {
  await resumeCollectionSaves();
  const response = await request("/api/sync/library");
  return (await response.json()) as CloudLibrarySyncPayload;
}

let replayFlight: Promise<void> | null = null;
/** Retry the exact intent and ID after lost acknowledgments; never bootstrap snapshots. */
async function resumeCollectionSaves() {
  if (replayFlight) return replayFlight;
  const { accountId, generation } = useDriveAppDataStore.getState();
  if (!accountId || !generation) return;
  const prefix = `drivebeats-collection-outbox-v1:${accountId}:${generation}:`;
  const flight = (async () => {
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith(prefix),
    );
    for (const key of keys) {
      if (
        useDriveAppDataStore.getState().generation !== generation ||
        useDriveAppDataStore.getState().accountId !== accountId
      )
        return;
      const saved = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (!saved) continue;
      if (
        typeof saved.input !== "string" ||
        !/^\/api\/(playlists|favorites)(\/|$)/.test(saved.input) ||
        !["POST", "PUT", "PATCH", "DELETE"].includes(saved.method) ||
        saved.generation !== generation
      )
        throw new Error("Pending collection change needs recovery");
      const response = await fetch(saved.input, {
        method: saved.method,
        body: saved.body,
        headers: {
          "Content-Type": "application/json",
          "X-DriveBeats-Generation": generation,
          "X-DriveBeats-Operation": saved.operationId,
        },
        signal: AbortSignal.timeout(CLOUD_API_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = await readError(response);
        if (response.status === 409)
          await advanceCollectionSave(
            key,
            saved.operationId,
            generation,
            error.resumeOperationId,
          );
        if (
          [400, 401, 403, 404, 422].includes(response.status) ||
          (response.status === 409 && error.code?.startsWith("PLAYLIST_"))
        ) {
          await removeCollectionSave(key);
          continue;
        }
        throw new CloudApiError(error.message, error.code);
      }
      await removeCollectionSave(key);
    }
  })().finally(() => {
    if (replayFlight === flight) replayFlight = null;
  });
  replayFlight = flight;
  return flight;
}

export async function bootstrapCloudLibrarySync(data: CloudLibrarySyncPayload) {
  await request("/api/sync/bootstrap", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createCloudPlaylist(input: CreatePlaylistInput) {
  await request("/api/playlists", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function renameCloudPlaylist(playlistId: string, name: string) {
  await request(`/api/playlists/${playlistId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteCloudPlaylist(playlistId: string) {
  await request(`/api/playlists/${playlistId}`, {
    method: "DELETE",
  });
}

export async function addCloudPlaylistTracks(
  playlistId: string,
  input: AddPlaylistTracksInput,
) {
  const response = await request(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify(input),
  });

  return (await response.json()) as AddPlaylistTracksResult;
}

export async function reorderCloudPlaylistTracks(
  playlistId: string,
  input: ReorderPlaylistTracksInput,
) {
  await request(`/api/playlists/${playlistId}/tracks/reorder`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function removeCloudPlaylistTrack(
  playlistId: string,
  fileId: string,
) {
  await request(`/api/playlists/${playlistId}/tracks/${fileId}`, {
    method: "DELETE",
  });
}

export async function setCloudFavorite(track: PlaylistTrack) {
  const payload: FavoriteTrackInput = { track };
  await request(`/api/favorites/${track.fileId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function removeCloudFavorite(track: PlaylistTrack) {
  const payload: FavoriteTrackInput = { track };
  await request(`/api/favorites/${track.fileId}`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}

export async function deleteAllCloudLibraryData() {
  await request("/api/me/cloud-data", {
    method: "DELETE",
  });
}

export async function resetGoogleDriveBackup(generation?: string) {
  const response = await request("/api/appdata/reset", {
    method: "POST",
    ...(generation
      ? { headers: { "X-DriveBeats-Generation": generation } }
      : {}),
  });
  return (await response.json()) as {
    reset: true;
    generation: string;
    cleanupPending?: boolean;
  };
}

export function isCloudLibraryEmpty(data: CloudLibrarySyncPayload) {
  return data.playlists.length === 0 && data.favorites.length === 0;
}

export function createCloudLibrarySnapshot(
  playlists: Playlist[],
  favorites: PlaylistTrack[],
): CloudLibrarySyncPayload {
  return {
    playlists,
    favorites,
  };
}
