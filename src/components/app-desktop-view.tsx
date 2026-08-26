"use client";

import { FileBrowser } from "@/components/file-browser";
import { FolderTree } from "@/components/folder-tree";
import { PlaylistView } from "@/components/playlist-view";
import { SplitView } from "@/components/split-view";
import type { FolderEntry, TrackCollection } from "@/types";

interface AppDesktopViewProps {
  activeCollection: TrackCollection | null;
  activePlaylistId: string | null;
  activeView: "files" | "playlist";
  currentFolderId: string;
  fileSearchResetKey: number;
  folderStack: FolderEntry[];
  onFolderNavigate: (folderStack: FolderEntry[]) => void;
  onSelectFolder: (path: FolderEntry[]) => void;
  onSelectPlaylist: (id: string) => void;
}

export function AppDesktopView({
  activeCollection,
  activePlaylistId,
  activeView,
  currentFolderId,
  fileSearchResetKey,
  folderStack,
  onFolderNavigate,
  onSelectFolder,
  onSelectPlaylist,
}: AppDesktopViewProps) {
  const sidebar = (
    <FolderTree
      selectedFolderId={activePlaylistId ? null : currentFolderId}
      onSelectFolder={onSelectFolder}
      activePlaylistId={activePlaylistId}
      onSelectPlaylist={onSelectPlaylist}
    />
  );

  const desktopMainContent =
    activeView === "playlist" && activeCollection ? (
      <PlaylistView collection={activeCollection} />
    ) : (
      <FileBrowser
        key={fileSearchResetKey}
        externalFolderStack={folderStack}
        onFolderNavigate={onFolderNavigate}
      />
    );

  return (
    <div className="h-full">
      {/* Landscape on a notched iPhone renders this (>= 768px wide) view, so the
          sidebar and the content column both need the horizontal insets. */}
      <div className="mx-auto h-full max-w-[1440px] px-safe">
        <SplitView sidebar={sidebar}>{desktopMainContent}</SplitView>
      </div>
    </div>
  );
}
