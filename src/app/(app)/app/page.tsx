"use client";

import { FolderOpen, ListMusic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { FileBrowser } from "@/components/file-browser";
import { FolderTree } from "@/components/folder-tree";
import { PlayerBar } from "@/components/player/player-bar";
import { PlaylistSection } from "@/components/playlist-section";
import { PlaylistView } from "@/components/playlist-view";
import { SplitView } from "@/components/split-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { cn, getHistoryStateWithFolderStack } from "@/lib/utils";
import { useFolderTreeStore } from "@/stores/folder-tree-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { FolderEntry } from "@/types";
import { INITIAL_STACK } from "@/types";

type ActiveView = "files" | "playlist";

function AppContent() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const playerBarPadding = usePlayerBarPadding();

  const [folderStack, setFolderStack] = useState<FolderEntry[]>(() => {
    if (typeof window === "undefined") return INITIAL_STACK;
    const historyFolderStack = window.history.state?.folderStack;
    if (Array.isArray(historyFolderStack) && historyFolderStack.length > 0) {
      return historyFolderStack;
    }
    return INITIAL_STACK;
  });
  const folderStackRef = useRef(folderStack);
  folderStackRef.current = folderStack;

  const currentFolderId = folderStack[folderStack.length - 1].id;

  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const playlists = usePlaylistStore((s) => s.playlists);
  const activePlaylist =
    playlists.find((p) => p.id === activePlaylistId) ?? null;

  const [activeView, setActiveView] = useState<ActiveView>("files");
  const [mobileTab, setMobileTab] = useState<"files" | "playlists">("files");
  const [mobilePlaylistId, setMobilePlaylistId] = useState<string | null>(null);

  const mobilePlaylist =
    playlists.find((p) => p.id === mobilePlaylistId) ?? null;

  const handleFolderNavigate = useCallback((newStack: FolderEntry[]) => {
    setFolderStack(newStack);
    window.history.pushState(getHistoryStateWithFolderStack(newStack), "");
    useFolderTreeStore.getState().expandPath(newStack.slice(0, -1));
  }, []);

  const handleTreeSelect = useCallback(
    (path: FolderEntry[]) => {
      setFolderStack(path);
      setActivePlaylist(null);
      setActiveView("files");
      window.history.pushState(getHistoryStateWithFolderStack(path), "");
    },
    [setActivePlaylist],
  );

  const handleSelectPlaylist = useCallback(
    (id: string) => {
      setActivePlaylist(id);
      setActiveView("playlist");
    },
    [setActivePlaylist],
  );

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    if (!window.history.state?.folderStack) {
      window.history.replaceState(
        getHistoryStateWithFolderStack(folderStackRef.current),
        "",
      );
    }

    const onPopState = (e: PopStateEvent) => {
      if (
        Array.isArray(e.state?.folderStack) &&
        e.state.folderStack.length > 0
      ) {
        setFolderStack(e.state.folderStack);
      } else {
        setFolderStack(INITIAL_STACK);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const sidebar = (
    <FolderTree
      selectedFolderId={currentFolderId}
      onSelectFolder={handleTreeSelect}
      activePlaylistId={activePlaylistId}
      onSelectPlaylist={handleSelectPlaylist}
    />
  );

  const mainContent =
    activeView === "playlist" && activePlaylist ? (
      <PlaylistView playlist={activePlaylist} />
    ) : (
      <FileBrowser
        externalFolderStack={folderStack}
        onFolderNavigate={handleFolderNavigate}
      />
    );

  return (
    <>
      {isDesktop ? (
        <div className="mx-auto h-full max-w-[1440px]">
          <SplitView sidebar={sidebar}>{mainContent}</SplitView>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 border-b">
            <button
              type="button"
              className={cn(
                "flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
                mobileTab === "files"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground",
              )}
              onClick={() => {
                setMobileTab("files");
                setMobilePlaylistId(null);
              }}
            >
              <FolderOpen className="size-4" />
              Files
            </button>
            <button
              type="button"
              className={cn(
                "flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
                mobileTab === "playlists"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground",
              )}
              onClick={() => {
                setMobileTab("playlists");
                setMobilePlaylistId(null);
              }}
            >
              <ListMusic className="size-4" />
              Playlists
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {mobileTab === "files" ? (
              <FileBrowser />
            ) : mobilePlaylist ? (
              <PlaylistView
                playlist={mobilePlaylist}
                onBack={() => setMobilePlaylistId(null)}
              />
            ) : (
              <div className="h-full overflow-y-auto px-2 pt-4">
                <PlaylistSection
                  activePlaylistId={mobilePlaylistId}
                  onSelectPlaylist={setMobilePlaylistId}
                />
                <div className={playerBarPadding} />
              </div>
            )}
          </div>
        </div>
      )}
      <PlayerBar />
    </>
  );
}

export default function AppPage() {
  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}
