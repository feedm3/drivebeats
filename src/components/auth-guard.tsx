"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { LoginButton } from "@/components/login-button";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { setTokens, isAuthenticated, refreshToken, refreshAccessToken } =
    useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Check URL for tokens from OAuth callback
    const params = new URLSearchParams(window.location.search);
    const tokensParam = params.get("tokens");
    if (tokensParam) {
      try {
        const tokens = JSON.parse(atob(tokensParam));
        setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_at);
      } catch {
        // ignore parse errors
      }
      window.history.replaceState({}, "", "/");
      setReady(true);
      return;
    }

    // Try refreshing if we have a stored refresh token but no access token
    if (refreshToken) {
      refreshAccessToken().then(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [setTokens, refreshToken, refreshAccessToken]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Getting things ready...</div>
      </div>
    );
  }

  if (!isAuthenticated()) {
    return <LoginButton />;
  }

  return <>{children}</>;
}
