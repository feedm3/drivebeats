"use client";

import {
  ChevronRight,
  Filter,
  Folder,
  ListMusic,
  Plus,
  RotateCw,
  Search,
} from "lucide-react";
import { FileListSkeleton } from "@/components/file-list-skeleton";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const SIDEBAR_FOLDER_ROWS = ["66%", "54%", "61%", "49%", "58%"];
const PLAYLIST_ROWS = ["52%", "64%", "45%"];

function SidebarFolderSkeleton() {
  return (
    <div className="px-2 pb-4">
      {SIDEBAR_FOLDER_ROWS.map((width) => (
        <div
          key={width}
          className="flex items-center gap-1 rounded-md py-1 pr-2"
          style={{ paddingLeft: 4 }}
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <ChevronRight className="size-3 text-muted-foreground" />
          </span>
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <Skeleton
            className="h-3.5 max-w-[10rem] rounded-full"
            style={{ width }}
          />
        </div>
      ))}
    </div>
  );
}

function SidebarPlaylistsSkeleton() {
  return (
    <div className="px-2">
      <div className="pb-4">
        {PLAYLIST_ROWS.map((width) => (
          <div
            key={width}
            className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          >
            <ListMusic className="size-4 shrink-0 text-muted-foreground" />
            <Skeleton
              className="h-3.5 flex-1 rounded-full"
              style={{ maxWidth: width }}
            />
            <Skeleton className="h-3 w-4 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pt-8 pb-2">
        <div className="group/hdr flex items-center gap-1 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground">
          Folders
          <ChevronRight className="size-3 rotate-90 opacity-0" />
        </div>
        <button
          type="button"
          className="relative inline-flex size-6 items-center justify-center text-muted-foreground"
          aria-label="Filter folders"
          tabIndex={-1}
        >
          <Filter className="size-3.5" />
        </button>
      </div>
      <SidebarFolderSkeleton />
      <div className="shrink-0 px-2 pt-6 pb-2">
        <div className="flex items-center gap-2 px-2">
          <div className="group/hdr flex min-w-0 flex-1 items-center gap-1 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground">
            Playlists
            <ChevronRight className="size-3 rotate-90 opacity-0" />
          </div>
          <div className="flex min-w-6 shrink-0 justify-center text-muted-foreground">
            <Plus className="size-3.5" />
          </div>
        </div>
      </div>
      <SidebarPlaylistsSkeleton />
    </div>
  );
}

function BrowserToolbarSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-h-8 items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">My Drive</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 shadow-xs backdrop-blur-sm sm:flex sm:max-w-xs">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Skeleton className="h-3.5 w-20 rounded-full" />
        </div>
        <div className="flex items-center sm:hidden">
          <Search className="size-3.5 text-muted-foreground" />
        </div>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center text-muted-foreground"
          aria-label="Refresh folder"
          tabIndex={-1}
        >
          <RotateCw className="size-4" />
        </button>
      </div>
    </div>
  );
}

function BrowserSkeleton({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto flex h-full flex-col overflow-hidden px-4 pt-8",
        mobile && "pt-6",
      )}
    >
      <BrowserToolbarSkeleton />
      <Separator className="my-3" />
      <div className="min-h-0 flex-1">
        <FileListSkeleton />
      </div>
    </div>
  );
}

export function AppLoadingShell() {
  return (
    <div className="h-full" aria-busy="true" aria-live="polite">
      <div className="mx-auto hidden h-full max-w-[1440px] md:flex">
        <div className="w-[280px] shrink-0 overflow-y-auto">
          <SidebarSkeleton />
        </div>
        <div className="w-px shrink-0 bg-border" />
        <div className="min-w-0 flex-1">
          <BrowserSkeleton />
        </div>
      </div>
      <div className="flex h-full flex-col md:hidden">
        <div className="flex shrink-0 border-b">
          <div className="flex flex-1 items-center justify-center gap-2 border-b-2 border-primary px-4 py-2.5 text-sm font-medium text-primary">
            <Folder className="size-4" />
            Files
          </div>
          <div className="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground">
            <ListMusic className="size-4" />
            Playlists
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <BrowserSkeleton mobile />
        </div>
      </div>
    </div>
  );
}
