"use client";

import {
  bootstrapCloudLibrarySync,
  createCloudLibrarySnapshot,
  fetchCloudLibrarySync,
  isCloudLibraryEmpty,
} from "@/lib/cloud-library-api";
import type {
  CloudLibrarySyncPayload,
  Id3SyncMetadata,
} from "@/lib/cloud-library-shared";
import {
  getFavoritesSignature,
  getPlaylistsSignature,
} from "@/lib/track-signature";
import { useAuthStore } from "@/stores/auth-store";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import {
  getFavoriteTracks,
  hasPendingFavoriteMutations,
  type TrackLibraryMeta,
  useLibraryStore,
  waitForPendingFavoriteMutations,
} from "@/stores/library-store";
import {
  hasPendingPlaylistMutations,
  usePlaylistStore,
  waitForPendingPlaylistMutations,
} from "@/stores/playlist-store";
import type { PlaylistTrack } from "@/types";

const CLOUD_BOOTSTRAP_KEY = "drivebeats-cloud-bootstrap-v1";

/**
 * Minimum time between two non-forced syncs.
 *
 * In an installed PWA every app switch (lock screen, notification, back to the
 * music) fires a resume event, and each unthrottled sync is a full Neon
 * round-trip for all playlists, favorites and track metadata. The user is the
 * main writer of their own library and their own mutations push to the cloud
 * immediately and update the stores optimistically, so polling only exists to
 * pick up edits made on another device. One minute bounds resume-triggered
 * traffic to a single query per minute while keeping cross-device convergence
 * well inside what feels instant when switching devices.
 */
export const CLOUD_SYNC_MIN_INTERVAL_MS = 60_000;

/**
 * A running fetch, split from applying its result. The fetch is caller-agnostic
 * and shared, so overlapping callers still cause a single round-trip, while each
 * caller decides for itself whether the payload may be applied on its behalf.
 *
 * `payload` never rejects: a failed sync resolves to `null`.
 */
interface CloudLibrarySyncFlight {
  /** Identity of the session the payload was fetched for. */
  sessionKey: string;
  payload: Promise<CloudLibrarySyncPayload | null>;
}

/**
 * Single-flight guard plus throttle window. Module scope rather than a ref so a
 * remount of the sync component cannot start a second overlapping sync.
 */
let syncInFlight: CloudLibrarySyncFlight | null = null;
let lastSyncStartedAt: number | null = null;

export interface CloudLibrarySyncOptions {
  /**
   * Bypass the throttle. Use for syncs that are required for correctness rather
   * than freshness, such as the first sync after sign-in.
   */
  force?: boolean;
  /**
   * Skip applying the payload on this caller's behalf, e.g. after the caller
   * unmounted. It only speaks for the caller that passed it: a payload another,
   * still live caller of the same session is waiting for is applied for that
   * caller regardless.
   */
  isCancelled?: () => boolean;
}

/**
 * Identifies the signed-in session, so a payload fetched for one session can
 * never be applied after the session changed underneath it — logging out and
 * writing the previous user's playlists back into the stores would be a real
 * bug. Token refreshes keep the same status and user id, so an expiring access
 * token does not invalidate a flight; only signing out (`clearTokens` flips the
 * status to `unauthenticated`) or a different account does.
 */
function getSessionKey() {
  const { authStatus, user } = useAuthStore.getState();
  return `${authStatus}:${user?.id ?? ""}`;
}

function canUseNetworkSync() {
  return typeof navigator === "undefined" || navigator.onLine;
}

export function hasPendingLocalMutations() {
  return hasPendingPlaylistMutations() || hasPendingFavoriteMutations();
}

async function waitForPendingLocalMutations() {
  await Promise.all([
    waitForPendingPlaylistMutations(),
    waitForPendingFavoriteMutations(),
  ]);
}

/**
 * Mirrors `toLibraryMeta` in the library store: incoming favorites fall back to
 * the fields already known locally, so a payload that omits optional metadata
 * would not actually change the store and must not count as a change.
 */
function resolveIncomingFavorites(
  favorites: PlaylistTrack[],
  tracks: Record<string, TrackLibraryMeta>,
): PlaylistTrack[] {
  return favorites.map((favorite) => {
    const existing = tracks[favorite.fileId];
    return {
      fileId: favorite.fileId,
      fileName: favorite.fileName,
      mimeType: favorite.mimeType ?? existing?.mimeType,
      size: favorite.size ?? existing?.size,
      modifiedTime: favorite.modifiedTime ?? existing?.modifiedTime,
      parents: favorite.parents ?? existing?.parents,
      parentFolderName: favorite.parentFolderName ?? existing?.parentFolderName,
    };
  });
}

/**
 * Mirrors the merge rule in `hydrateFromSync`: it only writes entries that are
 * missing locally or carry a newer `modifiedTime`.
 */
function hasNewTrackMetadata(record: Record<string, Id3SyncMetadata>) {
  const cache = useId3MetadataStore.getState().cache;

  for (const [fileId, metadata] of Object.entries(record)) {
    const existing = cache[fileId];
    if (
      !existing ||
      (metadata.modifiedTime && existing.modifiedTime !== metadata.modifiedTime)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Applies a cloud payload to the stores, skipping every replacement whose
 * result would be equivalent to the current state. The `replace*` calls rebuild
 * the playlist and favorite collections wholesale, so a redundant call
 * re-renders every subscriber and makes the offline download manager
 * re-evaluate its collections for nothing.
 */
export function applyCloudLibraryPayload(payload: CloudLibrarySyncPayload) {
  const playlistState = usePlaylistStore.getState();
  if (
    !playlistState.isCloudHydrated ||
    getPlaylistsSignature(playlistState.playlists) !==
      getPlaylistsSignature(payload.playlists)
  ) {
    playlistState.replacePlaylistsFromCloud(payload.playlists);
  }

  const libraryState = useLibraryStore.getState();
  if (
    !libraryState.isCloudHydrated ||
    getFavoritesSignature(getFavoriteTracks(libraryState.tracks)) !==
      getFavoritesSignature(
        resolveIncomingFavorites(payload.favorites, libraryState.tracks),
      )
  ) {
    libraryState.replaceFavoritesFromCloud(payload.favorites);
  }

  if (payload.trackMetadata && hasNewTrackMetadata(payload.trackMetadata)) {
    useId3MetadataStore.getState().hydrateFromSync(payload.trackMetadata);
  }
}

/**
 * Fetches the payload that should be applied, bootstrapping the cloud from local
 * data on first run. Returns `null` when there is nothing any caller may apply,
 * either because the sync failed or because local mutations are still in flight
 * and would be clobbered by cloud state that does not contain them yet.
 */
async function fetchApplicableCloudLibrary(): Promise<CloudLibrarySyncPayload | null> {
  try {
    let payload: CloudLibrarySyncPayload | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      await waitForPendingLocalMutations();

      const localPlaylists = usePlaylistStore.getState().playlists;
      const localFavorites = getFavoriteTracks(
        useLibraryStore.getState().tracks,
      );
      let nextPayload = await fetchCloudLibrarySync();

      if (
        typeof window !== "undefined" &&
        !window.localStorage.getItem(CLOUD_BOOTSTRAP_KEY) &&
        isCloudLibraryEmpty(nextPayload) &&
        (localPlaylists.length > 0 || localFavorites.length > 0)
      ) {
        const localId3Cache = useId3MetadataStore.getState().cache;
        const localMetadata =
          Object.keys(localId3Cache).length > 0 ? localId3Cache : undefined;
        await bootstrapCloudLibrarySync(
          createCloudLibrarySnapshot(
            localPlaylists,
            localFavorites,
            localMetadata,
          ),
        );
        nextPayload = await fetchCloudLibrarySync();
      }

      payload = nextPayload;

      if (!hasPendingLocalMutations()) {
        break;
      }
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(CLOUD_BOOTSTRAP_KEY, "1");
    }

    if (!payload || hasPendingLocalMutations()) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error("Cloud library sync failed:", error);
    return null;
  }
}

/**
 * Per-caller apply step. Runs once per caller of the shared flight, so a caller
 * that is still live is served even when the caller that started the flight is
 * long gone.
 */
function applyForCaller(
  payload: CloudLibrarySyncPayload | null,
  sessionKey: string,
  isCancelled?: () => boolean,
) {
  if (!payload) {
    return;
  }

  // This caller went away: another caller of the same session, if there is one,
  // still gets the payload through its own copy of this step.
  if (isCancelled?.()) {
    return;
  }

  // The session changed underneath the flight, so the payload belongs to a
  // session that is no longer the current one and must never be written back.
  if (getSessionKey() !== sessionKey) {
    return;
  }

  applyCloudLibraryPayload(payload);
}

/**
 * Runs a cloud library sync unless one is already in flight or the throttle
 * window is still open. A throttled call is a no-op, never a queued sync that
 * fires later.
 *
 * Callers that arrive while a sync of the same session runs share its fetch but
 * not its outcome: the returned promise resolves after this caller's own apply
 * step, so adopting an in-flight run can never leave a live caller believing it
 * synced while the stores stayed untouched.
 */
export function runCloudLibrarySync({
  force = false,
  isCancelled,
}: CloudLibrarySyncOptions = {}): Promise<void> {
  const sessionKey = getSessionKey();

  // Only a flight of the same session can be applied on this caller's behalf.
  // One started for another session is left to run out; its payload is dropped.
  if (syncInFlight && syncInFlight.sessionKey === sessionKey) {
    return syncInFlight.payload.then((payload) =>
      applyForCaller(payload, sessionKey, isCancelled),
    );
  }

  if (!canUseNetworkSync()) {
    return Promise.resolve();
  }

  const now = Date.now();
  if (
    !force &&
    lastSyncStartedAt !== null &&
    now - lastSyncStartedAt < CLOUD_SYNC_MIN_INTERVAL_MS
  ) {
    return Promise.resolve();
  }

  // Stamped at the start so a slow or failing sync cannot be retried on every
  // resume that happens while it runs.
  const previousSyncStartedAt = lastSyncStartedAt;
  lastSyncStartedAt = now;

  const flight: CloudLibrarySyncFlight = {
    sessionKey,
    payload: fetchApplicableCloudLibrary().then((payload) => {
      // A run that produced nothing anyone could apply must not hold the
      // throttle window open, or a failed sync would suppress its own retry.
      if (!payload && lastSyncStartedAt === now) {
        lastSyncStartedAt = previousSyncStartedAt;
      }

      if (syncInFlight === flight) {
        syncInFlight = null;
      }

      return payload;
    }),
  };

  syncInFlight = flight;

  return flight.payload.then((payload) =>
    applyForCaller(payload, sessionKey, isCancelled),
  );
}

/** Test helper: drops the throttle window and the single-flight guard. */
export function resetCloudLibrarySyncState() {
  syncInFlight = null;
  lastSyncStartedAt = null;
}
