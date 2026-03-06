"use client";

import { useEffect, useState } from "react";
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
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground animate-pulse">
          Getting things ready...
        </div>
      </div>
    );
  }

  if (!isAuthenticated()) {
    window.location.href = "/";
    return null;
  }

  return <>{children}</>;
}
