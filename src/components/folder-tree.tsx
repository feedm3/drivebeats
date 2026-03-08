"use client";

import { ChevronRight, Filter, Folder, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderFilterDialog } from "@/components/folder-filter-dialog";
import { FolderTreeNode } from "@/components/folder-tree-node";
import {
  PlaylistSection,
  type PlaylistSectionHandle,
} from "@/components/playlist-section";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { sortFoldersNatural } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useFolderFilterStore } from "@/stores/folder-filter-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

const STORAGE_KEY_FOLDERS = "sidebar-folders-collapsed";
const STORAGE_KEY_PLAYLISTS = "sidebar-playlists-collapsed";
const TREE_SKELETON_ROWS = ["66%", "54%", "61%", "49%", "58%"];

function readCollapsed(key: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(key) === "true";
}

function FolderTreeSkeleton() {
  return (
    <div aria-hidden="true">
      {TREE_SKELETON_ROWS.map((width) => (
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
  const [filterOpen, setFilterOpen] = useState(false);
  const { hiddenFolderIds, isHidden } = useFolderFilterStore();
  const playlistRef = useRef<PlaylistSectionHandle>(null);

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
    <div className="flex min-h-full flex-col">
      {/* Folders header */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-8 pb-2">
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
        <IconTooltip label="Filter folders">
          <Button
            variant="ghost"
            size="icon-xs"
            className="relative text-muted-foreground"
            onClick={() => setFilterOpen(true)}
            aria-label="Filter folders"
          >
            <Filter className="size-3.5" />
            {hiddenFolderIds.size > 0 && (
              <span className="absolute top-0 right-0 size-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </IconTooltip>
      </div>

      {/* Folders content */}
      {!foldersCollapsed && (
        <div className="px-2 pb-4">
          {loading ? (
            <FolderTreeSkeleton />
          ) : rootFolders.length === 0 ? (
            <div className="px-2 py-4 text-sm text-muted-foreground">
              No folders found
            </div>
          ) : (
            (() => {
              const visible = rootFolders.filter((f) => !isHidden(f.id));
              if (visible.length === 0) {
                return (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                    All folders hidden.{" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={() => setFilterOpen(true)}
                    >
                      Edit filter
                    </button>
                  </div>
                );
              }
              return (
                <div role="tree" aria-label="Folder tree">
                  {visible.map((folder) => (
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
              );
            })()
          )}
        </div>
      )}

      {/* Playlists header */}
      <div className="shrink-0 px-2 pt-6 pb-2">
        <div className="flex items-center gap-2 px-2">
          <button
            type="button"
            className="group/hdr flex min-w-0 flex-1 items-center gap-1 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:text-foreground"
            onClick={togglePlaylists}
            aria-expanded={!playlistsCollapsed}
          >
            Playlists
            <ChevronRight
              className={cn(
                "size-3 opacity-0 transition-all group-hover/hdr:opacity-100",
                !playlistsCollapsed && "rotate-90",
              )}
            />
          </button>
          <div className="flex min-w-6 shrink-0 justify-center">
            <IconTooltip label="Create playlist">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                onClick={() => playlistRef.current?.startCreating()}
                aria-label="Create playlist"
              >
                <Plus className="size-3.5" />
              </Button>
            </IconTooltip>
          </div>
        </div>
      </div>

      {/* Playlists content */}
      {!playlistsCollapsed && (
        <div className="px-2">
          <PlaylistSection
            ref={playlistRef}
            activePlaylistId={activePlaylistId}
            onSelectPlaylist={onSelectPlaylist}
            collapsed={playlistsCollapsed}
          />
          <div className={playerBarPadding} />
        </div>
      )}

      <FolderFilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        folders={rootFolders}
      />
    </div>
  );
}
