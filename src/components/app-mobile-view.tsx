"use client";

import { FolderOpen, ListMusic } from "lucide-react";
import { FileBrowser } from "@/components/file-browser";
import { PlaylistSection } from "@/components/playlist-section";
import { PlaylistView } from "@/components/playlist-view";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { cn } from "@/lib/utils";
import type { FolderEntry, TrackCollection } from "@/types";

interface AppMobileViewProps {
  activePlaylistId: string | null;
  fileSearchResetKey: number;
  folderStack: FolderEntry[];
  mobileCollection: TrackCollection | null;
  mobileTab: "files" | "playlists";
  onFolderNavigate: (folderStack: FolderEntry[]) => void;
  onMobileTabChange: (tab: "files" | "playlists") => void;
  onPlaylistBack: () => void;
  onSelectMobilePlaylist: (id: string) => void;
}

export function AppMobileView({
  activePlaylistId,
  fileSearchResetKey,
  folderStack,
  mobileCollection,
  mobileTab,
  onFolderNavigate,
  onMobileTabChange,
  onPlaylistBack,
  onSelectMobilePlaylist,
}: AppMobileViewProps) {
  const playerBarPadding = usePlayerBarPadding();

  return (
    // px-safe on the wrapper insets the tab strip and the content below it in
    // one place, so it is never applied twice further down the tree.
    <div className="flex h-full flex-col px-safe">
      <div className="flex shrink-0 border-b">
        <button
          type="button"
          className={cn(
            // These tabs are tap-only, so they need an explicit pressed state
            // now that the iOS tap highlight is gone.
            "flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors active:bg-accent",
            mobileTab === "files"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground",
          )}
          onClick={() => onMobileTabChange("files")}
        >
          <FolderOpen className="size-4" />
          Files
        </button>
        <button
          type="button"
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors active:bg-accent",
            mobileTab === "playlists"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground",
          )}
          onClick={() => onMobileTabChange("playlists")}
        >
          <ListMusic className="size-4" />
          Playlists
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {mobileTab === "files" ? (
          <FileBrowser
            key={fileSearchResetKey}
            externalFolderStack={folderStack}
            onFolderNavigate={onFolderNavigate}
          />
        ) : mobileCollection ? (
          <PlaylistView collection={mobileCollection} onBack={onPlaylistBack} />
        ) : (
          <div className="h-full overflow-y-auto overscroll-contain px-2 pt-4">
            <PlaylistSection
              activePlaylistId={activePlaylistId}
              onSelectPlaylist={onSelectMobilePlaylist}
            />
            <div className={playerBarPadding} />
          </div>
        )}
      </div>
    </div>
  );
}
