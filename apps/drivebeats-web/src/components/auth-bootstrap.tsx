"use client";

import { useEffect } from "react";
import type { AuthUser } from "@/lib/auth-session";
import { useAuthStore } from "@/stores/auth-store";

interface AuthBootstrapProps {
  initialUser: AuthUser | null;
}

export function AuthBootstrap({ initialUser }: AuthBootstrapProps) {
  useEffect(() => {
    if (!initialUser) {
      return;
    }

    const authStore = useAuthStore.getState();
    authStore.hydrateServerSession(initialUser);

    if (!authStore.isAuthenticated()) {
      void authStore.refreshAccessToken().catch(() => undefined);
    }
  }, [initialUser]);

  return null;
}
