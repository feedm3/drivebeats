"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLoadingShell } from "@/components/app-loading-shell";
import { AuthGuard } from "@/components/auth-guard";
import { PlayerBar } from "@/components/player/player-bar";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getHistoryStateWithFolderStack } from "@/lib/utils";
import { useFolderTreeStore } from "@/stores/folder-tree-store";
import {
  getFavoriteTracks,
  getRecentlyPlayedTracks,
  useLibraryStore,
} from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { FolderEntry, TrackCollection } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  INITIAL_STACK,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

const AppDesktopView = dynamic(
  () =>
    import("@/components/app-desktop-view").then((mod) => mod.AppDesktopView),
  {
    loading: () => <AppLoadingShell />,
  },
);

const AppMobileView = dynamic(
  () => import("@/components/app-mobile-view").then((mod) => mod.AppMobileView),
  {
    loading: () => <AppLoadingShell />,
  },
);

type ActiveView = "files" | "playlist";

interface AppPageClientProps {
  hasServerSession: boolean;
}

export function AppPageClient({ hasServerSession }: AppPageClientProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [folderStack, setFolderStack] = useState<FolderEntry[]>(() => {
    if (typeof window === "undefined") {
      return INITIAL_STACK;
    }

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
    if (typeof window === "undefined") {
      return "files";
    }

    return window.history.state?.activePlaylistId ? "playlist" : "files";
  });
  const [mobileTab, setMobileTab] = useState<"files" | "playlists">("files");
  const [mobilePlaylistId, setMobilePlaylistId] = useState<string | null>(null);
  const [fileSearchResetKey, setFileSearchResetKey] = useState(0);

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
    [favoriteTracks, playlists, recentlyPlayedTracks],
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
      window.history.pushState(getHistoryStateWithFolderStack(path, null), "");
    },
    [setActivePlaylist],
  );

  const handleNavigateToTrack = useCallback(() => {
    const { playingFolderStack } = usePlayerStore.getState();
    if (playingFolderStack.length === 0) {
      return;
    }

    // Always publish a navigation event, even when the track already belongs
    // to the Current Folder, so FileBrowser can exit an active search and show
    // the complete containing folder.
    setFolderStack([...playingFolderStack]);
    setFileSearchResetKey((key) => key + 1);
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

  const handleMobileTabChange = useCallback((tab: "files" | "playlists") => {
    setMobileTab(tab);
    setMobilePlaylistId(null);
  }, []);

  useEffect(() => {
    const restoredPlaylistId = window.history.state?.activePlaylistId ?? null;
    if (restoredPlaylistId) {
      setActivePlaylist(restoredPlaylistId);
    }
  }, [setActivePlaylist]);

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

  return (
    <AuthGuard hasServerSession={hasServerSession}>
      {/* `isDesktop` is null until the client has read the real viewport. The
          loading shell picks its layout with CSS, so it is correct on both
          form factors and keeps us from prerendering (and shipping) the wrong
          view chunk before we know which one the visitor needs. */}
      {isDesktop === null ? (
        <AppLoadingShell />
      ) : isDesktop ? (
        <AppDesktopView
          activeCollection={activeCollection}
          activePlaylistId={activePlaylistId}
          activeView={activeView}
          currentFolderId={currentFolderId}
          fileSearchResetKey={fileSearchResetKey}
          folderStack={folderStack}
          onFolderNavigate={handleFolderNavigate}
          onSelectFolder={handleTreeSelect}
          onSelectPlaylist={handleSelectPlaylist}
        />
      ) : (
        <AppMobileView
          activePlaylistId={mobilePlaylistId}
          fileSearchResetKey={fileSearchResetKey}
          folderStack={folderStack}
          mobileCollection={mobileCollection}
          mobileTab={mobileTab}
          onFolderNavigate={handleFolderNavigate}
          onMobileTabChange={handleMobileTabChange}
          onPlaylistBack={() => setMobilePlaylistId(null)}
          onSelectMobilePlaylist={setMobilePlaylistId}
        />
      )}
      <PlayerBar onNavigateToTrack={handleNavigateToTrack} />
    </AuthGuard>
  );
}
