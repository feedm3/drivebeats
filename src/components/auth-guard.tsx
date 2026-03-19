"use client";

import { useEffect, useState } from "react";
import { AppLoadingShell } from "@/components/app-loading-shell";
import { useAuthStore } from "@/stores/auth-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { useLibraryStore } from "@/stores/library-store";
import { useOfflineStore } from "@/stores/offline-store";
import { usePlaylistStore } from "@/stores/playlist-store";

const OFFLINE_STORE_HYDRATION_TIMEOUT_MS = 3_000;

function hasOfflinePlaybackAvailable() {
  const { collections, trackStatus } = useOfflineStore.getState();
  if (Object.keys(collections).length === 0) {
    return false;
  }

  return Object.values(trackStatus).some((status) => status === "downloaded");
}

function hasPersistedAppData() {
  const { rootFolders, rootFiles } = useImportedDriveStore.getState();
  const { playlists } = usePlaylistStore.getState();
  const { tracks } = useLibraryStore.getState();

  return (
    rootFolders.length > 0 ||
    rootFiles.length > 0 ||
    playlists.length > 0 ||
    Object.keys(tracks).length > 0 ||
    hasOfflinePlaybackAvailable()
  );
}

function canUseOfflineMode() {
  return hasPersistedAppData() || isOffline();
}

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

interface AuthGuardProps {
  children: React.ReactNode;
  hasServerSession?: boolean;
}

export function AuthGuard({
  children,
  hasServerSession = false,
}: AuthGuardProps) {
  const hasLiveSession = useAuthStore(
    (state) => state.authStatus === "authenticated" && !!state.user,
  );
  const refreshAccessToken = useAuthStore((state) => state.refreshAccessToken);
  const [offlineStoreHydrated, setOfflineStoreHydrated] = useState(() =>
    typeof window === "undefined"
      ? false
      : (useOfflineStore.persist?.hasHydrated?.() ?? false),
  );
  const [{ ready, offlineAccessAllowed }, setAccessState] = useState(() => ({
    ready: hasServerSession,
    offlineAccessAllowed: false,
  }));

  useEffect(() => {
    if (offlineStoreHydrated) {
      return;
    }

    if (!useOfflineStore.persist?.onFinishHydration) {
      setOfflineStoreHydrated(true);
      return;
    }

    const unsubscribe = useOfflineStore.persist.onFinishHydration(() => {
      setOfflineStoreHydrated(true);
    });
    const timeoutId = window.setTimeout(() => {
      setOfflineStoreHydrated(true);
    }, OFFLINE_STORE_HYDRATION_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [offlineStoreHydrated]);

  useEffect(() => {
    if (hasServerSession || hasLiveSession) {
      setAccessState({ ready: true, offlineAccessAllowed: false });
      return;
    }

    if (!offlineStoreHydrated) {
      return;
    }

    let cancelled = false;

    if (canUseOfflineMode()) {
      setAccessState({ ready: true, offlineAccessAllowed: true });
      return;
    }

    // Attempt refresh from the HttpOnly refresh-token cookie.
    refreshAccessToken().then((ok) => {
      if (cancelled) {
        return;
      }

      if (ok || hasLiveSession) {
        setAccessState({ ready: true, offlineAccessAllowed: false });
        return;
      }

      setAccessState({
        ready: true,
        offlineAccessAllowed: canUseOfflineMode(),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    hasLiveSession,
    hasServerSession,
    offlineStoreHydrated,
    refreshAccessToken,
  ]);

  if (!ready) {
    return <AppLoadingShell />;
  }

  if (!(hasServerSession || hasLiveSession) && !offlineAccessAllowed) {
    window.location.href = "/";
    return null;
  }

  return <>{children}</>;
}
