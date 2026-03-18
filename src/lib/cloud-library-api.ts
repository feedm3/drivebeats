"use client";

import type {
  AddPlaylistTracksInput,
  CloudLibrarySyncPayload,
  CreatePlaylistInput,
  FavoriteTrackInput,
  ReorderPlaylistTracksInput,
} from "@/lib/cloud-library-shared";
import type { Playlist, PlaylistTrack } from "@/types";

const CLOUD_API_TIMEOUT_MS = 10_000;

async function readError(response: Response) {
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (data?.error) {
    return data.error;
  }

  return `${response.status} ${response.statusText}`.trim();
}

async function request(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(input, {
      cache: "no-store",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
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
    throw new Error(await readError(response));
  }

  return response;
}

export async function fetchCloudLibrarySync() {
  const response = await request("/api/sync/library");
  return (await response.json()) as CloudLibrarySyncPayload;
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
  await request(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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
