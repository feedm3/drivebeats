"use client";

import { useEffect } from "react";
import { AppHeader } from "@/components/app-header";
import { CloudLibrarySync } from "@/components/cloud-library-sync";
import { GooglePickerCloseButton } from "@/components/google-picker-close-button";
import { GooglePickerScripts } from "@/components/google-picker-scripts";
import { OfflineStatusBanner } from "@/components/offline-status-banner";
import { Providers } from "@/components/providers";
import { initOfflineSync } from "@/lib/offline-download-manager";

export function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initOfflineSync();
  }, []);

  return (
    <Providers>
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
