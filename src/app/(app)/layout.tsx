"use client";

import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/app-header";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex h-dvh flex-col overflow-hidden">
        <AppHeader />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </Providers>
  );
}
