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

      // The store only reports "unauthenticated" when the server gave an
      // authoritative verdict. A transient failure (offline, 5xx) leaves the
      // session intact, so keep the user in the app instead of bouncing them
      // to the landing page.
      const sessionRejected =
        useAuthStore.getState().authStatus === "unauthenticated";

      setAccessState({
        ready: true,
        offlineAccessAllowed: !sessionRejected || canUseOfflineMode(),
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

  const accessAllowed =
    hasServerSession || hasLiveSession || offlineAccessAllowed;

  // Redirecting is a side effect, so it must not run during render.
  useEffect(() => {
    if (!ready || accessAllowed) {
      return;
    }

    window.location.href = "/";
  }, [ready, accessAllowed]);

  if (!ready || !accessAllowed) {
    return <AppLoadingShell />;
  }

  return <>{children}</>;
}
