"use client";

import { useEffect } from "react";
import type { AuthUser } from "@/lib/auth-session";
import { useAuthStore } from "@/stores/auth-store";

interface AuthBootstrapProps {
  initialUser: AuthUser | null;
}

export function AuthBootstrap({ initialUser }: AuthBootstrapProps) {
  const offlineReady = useAuthStore((state) => state.appDataOfflineReady);
  const ready = useAuthStore((state) => state.appDataReady);
  useEffect(() => {
    if (!initialUser) {
      return;
    }

    const authStore = useAuthStore.getState();
    authStore.hydrateServerSession(initialUser);

    if (
      ready &&
      !offlineReady &&
      navigator.onLine &&
      !authStore.isAuthenticated()
    ) {
      void authStore.refreshAccessToken().catch(() => undefined);
    }
  }, [initialUser, ready, offlineReady]);

  return null;
}
