"use client";

import { ChevronRight, Ellipsis, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DriveImportButton } from "@/components/drive-import-button";
import { FolderTreeNode } from "@/components/folder-tree-node";
import { ManageFoldersDialog } from "@/components/manage-folders-dialog";
import { PlaylistSection } from "@/components/playlist-section";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useDriveImport } from "@/hooks/use-drive-import";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { sortFoldersNatural } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import type { FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

const STORAGE_KEY_FOLDERS = "sidebar-folders-collapsed";
const STORAGE_KEY_PLAYLISTS = "sidebar-playlists-collapsed";
const MENU_ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

function readCollapsed(key: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(key) === "true";
}

interface FolderTreeProps {
  selectedFolderId: string | null;
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
  const importedRootFolders = useImportedDriveStore(
    (state) => state.rootFolders,
  );
  const importedRootFileCount = useImportedDriveStore(
    (state) => state.rootFiles.length,
  );
  const { importFromDrive, isImporting } = useDriveImport();
  const playerBarPadding = usePlayerBarPadding();

  const [foldersCollapsed, setFoldersCollapsed] = useState(() =>
    readCollapsed(STORAGE_KEY_FOLDERS),
  );
  const [playlistsCollapsed, setPlaylistsCollapsed] = useState(() =>
    readCollapsed(STORAGE_KEY_PLAYLISTS),
  );
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false);
  const rootFolders = useMemo(
    () =>
      sortFoldersNatural(
        importedRootFolders.filter((folder) => folder.mimeType === FOLDER_MIME),
      ),
    [importedRootFolders],
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

  return (
    <div className="flex min-h-full flex-col">
      {/* Folders header */}
      <div className="flex shrink-0 items-center gap-2 px-4 pt-8 pb-2">
        <button
          type="button"
          className="group/hdr flex min-w-0 flex-1 items-center gap-1 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:text-foreground"
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
        {!foldersCollapsed && (
          <div className="flex min-w-6 shrink-0 justify-center">
            <Popover open={folderMenuOpen} onOpenChange={setFolderMenuOpen}>
              <IconTooltip label="Folder options">
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label="Folder options"
                    />
                  }
                >
                  <Ellipsis className="size-3.5" />
                </PopoverTrigger>
              </IconTooltip>
              <PopoverContent side="bottom" align="end" className="w-48">
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    setFolderMenuOpen(false);
                    void importFromDrive();
                  }}
                  disabled={isImporting}
                >
                  <Plus className="size-3.5" />
                  Add from Drive
                </button>
                <Separator className="my-1 bg-border/60" />
                <button
                  type="button"
                  className={cn(MENU_ITEM_CLASS, "text-destructive")}
                  onClick={() => {
                    setFolderMenuOpen(false);
                    setManageFoldersOpen(true);
                  }}
                  disabled={rootFolders.length === 0}
                >
                  <Trash2 className="size-3.5" />
                  Remove folders…
                </button>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {/* Folders content */}
      {!foldersCollapsed && (
        <div className="animate-in fade-in slide-in-from-left-2 duration-200 px-2 pb-4">
          {rootFolders.length === 0 ? (
            <div className="space-y-3 px-2 py-4 text-sm text-muted-foreground">
              <p>
                {importedRootFileCount > 0
                  ? "Tracks-only imports are available in Library."
                  : "No imported folders yet."}
              </p>
              <DriveImportButton size="sm" className="w-full justify-center">
                {importedRootFileCount > 0
                  ? "Add folder from Drive"
                  : "Add from Drive"}
              </DriveImportButton>
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

      {/* Playlists header */}
      <div className="shrink-0 px-4 pt-6 pb-2">
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Playlists content */}
      {!playlistsCollapsed && (
        <div className="px-2">
          <PlaylistSection
            activePlaylistId={activePlaylistId}
            onSelectPlaylist={onSelectPlaylist}
            collapsed={playlistsCollapsed}
          />
          <div className={playerBarPadding} />
        </div>
      )}

      {manageFoldersOpen && (
        <ManageFoldersDialog
          open={manageFoldersOpen}
          onOpenChange={setManageFoldersOpen}
          onFolderRemoved={() => onSelectFolder(INITIAL_STACK)}
        />
      )}
    </div>
  );
}
