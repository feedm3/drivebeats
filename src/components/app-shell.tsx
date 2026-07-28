"use client";

import { useEffect } from "react";
import { AppHeader } from "@/components/app-header";
import { AuthBootstrap } from "@/components/auth-bootstrap";
import { CloudLibrarySync } from "@/components/cloud-library-sync";
import { GooglePickerCloseButton } from "@/components/google-picker-close-button";
import { GooglePickerScripts } from "@/components/google-picker-scripts";
import { OfflineStatusBanner } from "@/components/offline-status-banner";
import { Providers } from "@/components/providers";
import type { AuthUser } from "@/lib/auth-session";
import { initOfflineSync } from "@/lib/offline-download-manager";

interface AppShellProps {
  children: React.ReactNode;
  initialUser: AuthUser | null;
}

export function AppShell({ children, initialUser }: AppShellProps) {
  useEffect(() => {
    initOfflineSync();
  }, []);

  return (
    <Providers>
      <AuthBootstrap initialUser={initialUser} />
      <CloudLibrarySync />
      <GooglePickerScripts />
      <GooglePickerCloseButton />
      {/* `pt-safe` lives on this container, not on the header, so the top inset
          is applied exactly once no matter whether OfflineStatusBanner is
          rendering above the header. The status bar strip it frees up shows the
          body background, which is the same color as the theme-color meta. */}
      {/* `data-app-shell` is the scope for the touch rules in globals.css:
          everything below here is chrome, so long-press callouts and text
          selection are off (inputs opt back in). The marketing pages render
          outside this subtree and stay selectable. */}
      <div
        data-app-shell
        className="flex h-dvh flex-col overflow-hidden pt-safe"
      >
        <OfflineStatusBanner />
        <AppHeader />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </Providers>
  );
}
