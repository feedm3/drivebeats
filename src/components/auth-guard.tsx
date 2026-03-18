"use client";

import { useEffect, useState } from "react";
import { AppLoadingShell } from "@/components/app-loading-shell";
import { useAuthStore } from "@/stores/auth-store";
import { useOfflineStore } from "@/stores/offline-store";

const OFFLINE_STORE_HYDRATION_TIMEOUT_MS = 3_000;

function hasOfflinePlaybackAvailable() {
  const { collections, trackStatus } = useOfflineStore.getState();
  if (Object.keys(collections).length === 0) {
    return false;
  }

  return Object.values(trackStatus).some((status) => status === "downloaded");
}

function canUseOfflineMode() {
  return (
    typeof navigator !== "undefined" &&
    !navigator.onLine &&
    hasOfflinePlaybackAvailable()
  );
}

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const refreshAccessToken = useAuthStore((state) => state.refreshAccessToken);
  const [offlineStoreHydrated, setOfflineStoreHydrated] = useState(() =>
    typeof window === "undefined"
      ? false
      : useOfflineStore.persist?.hasHydrated?.() ?? false,
  );
  const [ready, setReady] = useState(false);
  const [offlineAccessAllowed, setOfflineAccessAllowed] = useState(false);

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
    if (!offlineStoreHydrated) {
      return;
    }

    let cancelled = false;

    if (isAuthenticated()) {
      setReady(true);
      return;
    }

    if (canUseOfflineMode()) {
      setOfflineAccessAllowed(true);
      setReady(true);
      return;
    }

    if (isOffline()) {
      setOfflineAccessAllowed(true);
      setReady(true);
      return;
    }

    // Attempt refresh from the HttpOnly refresh-token cookie.
    refreshAccessToken().then((ok) => {
      if (cancelled) {
        return;
      }

      if (ok || isAuthenticated()) {
        setReady(true);
        return;
      }

      if (canUseOfflineMode()) {
        setOfflineAccessAllowed(true);
      }

      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, offlineStoreHydrated, refreshAccessToken]);

  if (!ready) {
    return <AppLoadingShell />;
  }

  if (!isAuthenticated() && !offlineAccessAllowed) {
    window.location.href = "/";
    return null;
  }

  return <>{children}</>;
}
