"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FolderTreeNode } from "@/components/folder-tree-node";
import { PlaylistSection } from "@/components/playlist-section";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { sortFoldersNatural } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

const STORAGE_KEY_FOLDERS = "sidebar-folders-collapsed";
const STORAGE_KEY_PLAYLISTS = "sidebar-playlists-collapsed";

function readCollapsed(key: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(key) === "true";
}

interface FolderTreeProps {
  selectedFolderId: string;
  onSelectFolder: (path: FolderEntry[]) => void;
  activePlaylistId: string | null;
  onSelectPlaylist: (id: string) => void;
}

export function FolderTree({
  selectedFolderId,
  onSelectFolder,
  activePlaylistId,
  onSelectPlaylist,
}: FolderTreeProps) {
  const { fetchFromApi } = useFolderContents();
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);
  const [rootFolders, setRootFolders] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const playerBarPadding = usePlayerBarPadding();

  const [foldersCollapsed, setFoldersCollapsed] = useState(() =>
    readCollapsed(STORAGE_KEY_FOLDERS),
  );
  const [playlistsCollapsed, setPlaylistsCollapsed] = useState(() =>
    readCollapsed(STORAGE_KEY_PLAYLISTS),
  );

  const toggleFolders = useCallback(() => {
    setFoldersCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY_FOLDERS, String(next));
      return next;
    });
  }, []);

  const togglePlaylists = useCallback(() => {
    setPlaylistsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY_PLAYLISTS, String(next));
      return next;
    });
  }, []);

  const loadRoot = useCallback(async () => {
    const cached = getCachedFiles("root");
    if (cached) {
      setRootFolders(
        sortFoldersNatural(
          cached.files.filter((f) => f.mimeType === FOLDER_MIME),
        ),
      );
      setLoading(false);
      return;
    }
    const files = await fetchFromApi("root");
    if (files) {
      setRootFolders(
        sortFoldersNatural(files.filter((f) => f.mimeType === FOLDER_MIME)),
      );
    }
    setLoading(false);
  }, [getCachedFiles, fetchFromApi]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="shrink-0 px-4 pt-8 pb-2">
          <button
            type="button"
            className="group/hdr flex items-center gap-1 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:text-foreground"
            onClick={toggleFolders}
            aria-expanded={!foldersCollapsed}
          >
            Folders
            <ChevronRight
              className={cn(
                "size-3 opacity-0 transition-all group-hover/hdr:opacity-100",
                !foldersCollapsed && "rotate-90",
              )}
            />
          </button>
        </div>
        {!foldersCollapsed && (
          <div className="px-2 pb-4">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : rootFolders.length === 0 ? (
              <div className="px-2 py-4 text-sm text-muted-foreground">
                No folders found
              </div>
            ) : (
              <div role="tree" aria-label="Folder tree">
                {rootFolders.map((folder) => (
                  <FolderTreeNode
                    key={folder.id}
                    id={folder.id}
                    name={folder.name}
                    depth={0}
                    ancestors={INITIAL_STACK}
                    selectedFolderId={selectedFolderId}
                    onSelect={onSelectFolder}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <PlaylistSection
          activePlaylistId={activePlaylistId}
          onSelectPlaylist={onSelectPlaylist}
          collapsed={playlistsCollapsed}
          onToggleCollapsed={togglePlaylists}
        />
        <div className={playerBarPadding} />
      </ScrollArea>
    </div>
  );
}
