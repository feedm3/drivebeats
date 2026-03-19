"use client";

import { ChevronDown, HardDrive, LogOut, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { StorageDialog } from "@/components/storage-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { logoutAndRedirect } from "@/lib/clear-local-data";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

function getUserLabel(name: string | null, email: string) {
  if (name) {
    const [firstName] = name.trim().split(/\s+/);
    if (firstName) return firstName;
    return name;
  }

  return email.split("@")[0] ?? email;
}

function getUserInitials(name: string | null, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

interface AccountAvatarProps {
  picture: string | null;
  initials: string;
  sizeClassName: string;
  className?: string;
}

function AccountAvatar({
  picture,
  initials,
  sizeClassName,
  className = "",
}: AccountAvatarProps) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const showPicture = Boolean(picture && picture !== failedPicture);

  if (picture && showPicture) {
    return (
      // biome-ignore lint/performance/noImgElement: Google profile images use dynamic remote URLs that are not routed through next/image.
      <img
        alt=""
        aria-hidden="true"
        src={picture}
        className={cn(sizeClassName, "rounded-full object-cover", className)}
        onError={() => setFailedPicture(picture)}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        sizeClassName,
        "flex items-center justify-center rounded-full bg-primary/10 text-primary",
        className,
      )}
    >
      {initials ? (
        <span className="text-[0.65rem] font-semibold tracking-[0.08em]">
          {initials}
        </span>
      ) : (
        <UserRound className="size-[55%]" />
      )}
    </span>
  );
}

export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [offlineStorageOpen, setOfflineStorageOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const userLabel = user ? getUserLabel(user.name, user.email) : null;
  const userInitials = user ? getUserInitials(user.name, user.email) : "";

  async function handleLogout() {
    setIsLoggingOut(true);
    await logoutAndRedirect();
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
          <div className="relative">
            {user ? (
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-full py-1 pr-1.5 pl-1 text-muted-foreground/80 transition-colors hover:bg-muted/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label="Open account menu"
                    />
                  }
                >
                  <span className="relative flex shrink-0">
                    <AccountAvatar
                      picture={user.picture}
                      initials={userInitials}
                      sizeClassName="size-7"
                    />
                    <span className="absolute right-0 bottom-0 size-2 rounded-full border-2 border-background bg-emerald-500" />
                  </span>
                  <span className="hidden max-w-24 truncate text-[11px] font-medium tracking-[0.02em] text-foreground/70 sm:block">
                    {userLabel}
                  </span>
                  <ChevronDown
                    className={`size-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={8}
                  className="w-64 rounded-[1.35rem] border-border/70 bg-background/96 p-2 shadow-lg backdrop-blur-sm"
                >
                  <div className="flex items-center gap-3 px-2.5 py-2">
                    <AccountAvatar
                      picture={user.picture}
                      initials={userInitials}
                      sizeClassName="size-9 shrink-0"
                      className="border border-border/60"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium leading-tight">
                        {user.name ?? userLabel}
                      </p>
                      <p className="truncate pt-0.5 text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <div className="mx-1 my-1 h-px bg-border/60" />
                  <div className="flex items-center justify-between gap-4 px-2.5 py-2.5">
                    <span className="text-sm font-medium text-foreground/90">
                      Theme
                    </span>
                    <ThemeToggle size="menu" />
                  </div>
                  <div className="mx-1 my-1 h-px bg-border/60" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setOfflineStorageOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <HardDrive className="size-4" />
                    Storage & data
                  </button>
                  <div className="mx-1 my-1 h-px bg-border/60" />
                  <button
                    type="button"
                    onClick={() => setLogoutOpen(true)}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-destructive/8 hover:text-destructive"
                  >
                    <LogOut className="size-4" />
                    Logout
                  </button>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>
      </div>
      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent>
          <DialogTitle>Log out and clear this device</DialogTitle>
          <DialogDescription>
            Logging out will remove cached playlists, favorites, recently played
            tracks, imported library, offline downloads, and saved player state
            from this browser. Your synced cloud data will stay in your account.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? "Logging out..." : "Log out and clear device"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <StorageDialog
        open={offlineStorageOpen}
        onOpenChange={setOfflineStorageOpen}
      />
    </header>
  );
}
