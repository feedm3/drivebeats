"use client";

import { FolderOpen, ListMusic } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usePlayerStore } from "@/stores/player-store";
import {
  getFavoriteTracks,
  getRecentlyPlayedTracks,
  useLibraryStore,
} from "@/stores/library-store";
import { useOfflineStore } from "@/stores/offline-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { FolderEntry, TrackCollection } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  INITIAL_STACK,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

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
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const favoriteTracks = useMemo(
    () => getFavoriteTracks(libraryTracks),
    [libraryTracks],
  );
  const recentlyPlayedTracks = useMemo(
    () => getRecentlyPlayedTracks(libraryTracks),
    [libraryTracks],
  );

  const [activeView, setActiveView] = useState<ActiveView>(() => {
    if (typeof window === "undefined") return "files";
    return window.history.state?.activePlaylistId ? "playlist" : "files";
  });
  const [mobileTab, setMobileTab] = useState<"files" | "playlists">("files");
  const [mobilePlaylistId, setMobilePlaylistId] = useState<string | null>(null);

  useEffect(() => {
    const offlineStore = useOfflineStore.getState();
    void offlineStore.hydrateFromStorage();

    const applyOnlineState = () => {
      useOfflineStore.getState().setNetworkOffline(!navigator.onLine);
    };

    applyOnlineState();
    window.addEventListener("online", applyOnlineState);
    window.addEventListener("offline", applyOnlineState);
    return () => {
      window.removeEventListener("online", applyOnlineState);
      window.removeEventListener("offline", applyOnlineState);
    };
  }, []);

  const collections: TrackCollection[] = useMemo(
    () => [
      {
        id: FAVORITES_COLLECTION_ID,
        kind: "favorites" as const,
        name: "Favorites",
        tracks: favoriteTracks,
      },
      {
        id: RECENTLY_PLAYED_COLLECTION_ID,
        kind: "recently-played" as const,
        name: "Recently played",
        tracks: recentlyPlayedTracks,
      },
      ...playlists,
    ],
    [favoriteTracks, recentlyPlayedTracks, playlists],
  );

  const activeCollection =
    collections.find((collection) => collection.id === activePlaylistId) ??
    null;
  const mobileCollection =
    collections.find((collection) => collection.id === mobilePlaylistId) ??
    null;

  const handleFolderNavigate = useCallback((newStack: FolderEntry[]) => {
    setFolderStack(newStack);
    window.history.pushState(
      getHistoryStateWithFolderStack(newStack, null),
      "",
    );
    useFolderTreeStore.getState().expandPath(newStack.slice(0, -1));
  }, []);

  const handleTreeSelect = useCallback(
    (path: FolderEntry[]) => {
      setFolderStack(path);
      setActivePlaylist(null);
      setActiveView("files");
      window.history.pushState(
        getHistoryStateWithFolderStack(path, null),
        "",
      );
    },
    [setActivePlaylist],
  );

  const handleNavigateToTrack = useCallback(() => {
    const { playingFolderStack } = usePlayerStore.getState();
    if (playingFolderStack.length === 0) return;
    setFolderStack(playingFolderStack);
    setActivePlaylist(null);
    setActiveView("files");
    window.history.pushState(
      getHistoryStateWithFolderStack(playingFolderStack, null),
      "",
    );
    useFolderTreeStore.getState().expandPath(playingFolderStack.slice(0, -1));
  }, [setActivePlaylist]);

  const handleSelectPlaylist = useCallback(
    (id: string) => {
      setActivePlaylist(id);
      setActiveView("playlist");
      window.history.pushState(
        getHistoryStateWithFolderStack(folderStackRef.current, id),
        "",
      );
    },
    [setActivePlaylist],
  );

  // Restore active playlist from history state on mount
  useEffect(() => {
    const restoredPlaylistId = window.history.state?.activePlaylistId ?? null;
    if (restoredPlaylistId) {
      setActivePlaylist(restoredPlaylistId);
    }
  }, [setActivePlaylist]);

  // Seed initial history state & listen for back/forward
  useEffect(() => {
    if (!window.history.state?.folderStack) {
      window.history.replaceState(
        getHistoryStateWithFolderStack(folderStackRef.current, null),
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

      const playlistId: string | null = e.state?.activePlaylistId ?? null;
      setActivePlaylist(playlistId);
      setActiveView(playlistId ? "playlist" : "files");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setActivePlaylist]);

  const sidebar = (
    <FolderTree
      selectedFolderId={activePlaylistId ? null : currentFolderId}
      onSelectFolder={handleTreeSelect}
      activePlaylistId={activePlaylistId}
      onSelectPlaylist={handleSelectPlaylist}
    />
  );

  const mainContent =
    activeView === "playlist" && activeCollection ? (
      <PlaylistView collection={activeCollection} />
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
            ) : mobileCollection ? (
              <PlaylistView
                collection={mobileCollection}
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
      <PlayerBar onNavigateToTrack={handleNavigateToTrack} />
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
