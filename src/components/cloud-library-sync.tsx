"use client";

import { useEffect, useRef } from "react";
import {
  bootstrapCloudLibrarySync,
  createCloudLibrarySnapshot,
  fetchCloudLibrarySync,
  isCloudLibraryEmpty,
} from "@/lib/cloud-library-api";
import { useAuthStore } from "@/stores/auth-store";
import {
  getFavoriteTracks,
  hasPendingFavoriteMutations,
  useLibraryStore,
  waitForPendingFavoriteMutations,
} from "@/stores/library-store";
import {
  hasPendingPlaylistMutations,
  usePlaylistStore,
  waitForPendingPlaylistMutations,
} from "@/stores/playlist-store";

const CLOUD_BOOTSTRAP_KEY = "drivebeats-cloud-bootstrap-v1";

function canUseNetworkSync() {
  return typeof navigator === "undefined" || navigator.onLine;
}

function hasPendingLocalMutations() {
  return hasPendingPlaylistMutations() || hasPendingFavoriteMutations();
}

async function waitForPendingLocalMutations() {
  await Promise.all([
    waitForPendingPlaylistMutations(),
    waitForPendingFavoriteMutations(),
  ]);
}

export function CloudLibrarySync() {
  const authStatus = useAuthStore((state) => state.authStatus);
  const syncInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let cancelled = false;

    const runSync = async () => {
      if (!canUseNetworkSync() || syncInFlightRef.current) {
        return syncInFlightRef.current;
      }

      syncInFlightRef.current = (async () => {
        try {
          let payload = null;

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
              await bootstrapCloudLibrarySync(
                createCloudLibrarySnapshot(localPlaylists, localFavorites),
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

          if (cancelled || !payload || hasPendingLocalMutations()) {
            return;
          }

          usePlaylistStore
            .getState()
            .replacePlaylistsFromCloud(payload.playlists);
          useLibraryStore
            .getState()
            .replaceFavoritesFromCloud(payload.favorites);
        } catch (error) {
          console.error("Cloud library sync failed:", error);
        } finally {
          syncInFlightRef.current = null;
        }
      })();

      return syncInFlightRef.current;
    };

    void runSync();

    const onFocus = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void runSync();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [authStatus]);

  return null;
}
