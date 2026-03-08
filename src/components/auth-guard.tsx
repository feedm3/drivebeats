"use client";

import { useEffect, useState } from "react";
import { AppLoadingShell } from "@/components/app-loading-shell";
import { useAuthStore } from "@/stores/auth-store";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const refreshAccessToken = useAuthStore((state) => state.refreshAccessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      setReady(true);
      return;
    }

    // Attempt refresh from the HttpOnly refresh-token cookie.
    refreshAccessToken().then(() => setReady(true));
  }, [isAuthenticated, refreshAccessToken]);

  if (!ready) {
    return <AppLoadingShell />;
  }

  if (!isAuthenticated()) {
    window.location.href = "/";
    return null;
  }

  return <>{children}</>;
}
