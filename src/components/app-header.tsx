"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { usePlayerStore } from "@/stores/player-store";

export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    usePlayerStore.getState().clearCache();
    useFolderCacheStore.getState().clear();
    await useAuthStore.getState().logout();
    window.location.href = "/";
  }

  return (
    <header className="relative z-10 border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4">
        <Link
          href="/app"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Image
            src="/web-app-manifest-192x192.png"
            alt="DriveBeats"
            width={28}
            height={28}
            className="rounded-md"
          />
          DriveBeats
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-background py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
