"use client";

import { AppHeader } from "@/components/app-header";
import { GooglePickerCloseButton } from "@/components/google-picker-close-button";
import { GooglePickerScripts } from "@/components/google-picker-scripts";
import { Providers } from "@/components/providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <GooglePickerScripts />
      <GooglePickerCloseButton />
      <div className="flex h-dvh flex-col overflow-hidden">
        <AppHeader />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </Providers>
  );
}
