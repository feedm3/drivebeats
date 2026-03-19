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
      <div className="flex h-dvh flex-col overflow-hidden">
        <OfflineStatusBanner />
        <AppHeader />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </Providers>
  );
}
