"use client";

import { ChevronRight, Folder, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderTreeRow } from "@/components/folder-tree-row";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { sortFoldersNatural } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useFolderTreeStore } from "@/stores/folder-tree-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME } from "@/types";

interface FolderTreeNodeProps {
  id: string;
  name: string;
  depth: number;
  ancestors: FolderEntry[];
  selectedFolderId: string | null;
  onSelect: (path: FolderEntry[]) => void;
}

export function FolderTreeNode({
  id,
  name,
  depth,
  ancestors,
  selectedFolderId,
  onSelect,
}: FolderTreeNodeProps) {
  const isExpanded = useFolderTreeStore((s) => s.expandedFolders.has(id));
  const toggle = useFolderTreeStore((s) => s.toggle);

  const cachedEntry = useFolderCacheStore((s) => s.cache.get(id));
  const { fetchFromApi } = useFolderContents();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playingFolderStack = usePlayerStore((s) => s.playingFolderStack);

  const [children, setChildren] = useState<DriveFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isSelected = selectedFolderId === id;
  const hasChildren = children === null || children.length > 0;
  const isPlayingAncestor =
    currentTrack && playingFolderStack.some((f) => f.id === id);

  const loadChildren = useCallback(
    async (signal: AbortSignal) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const canCommit = () =>
        !signal.aborted &&
        !useAuthStore.getState().isLoggingOut &&
        (useAuthStore.getState().user?.id ?? null) === userId;
      // Persisted listings hydrate asynchronously; without waiting, a cold start
      // would refetch folders that are already cached on this device.
      await useFolderCacheStore.getState().hydrate();

      if (!canCommit()) return;
      const cached = useFolderCacheStore.getState().getFiles(id);
      if (cached) {
        setChildren(
          sortFoldersNatural(
            cached.files.filter((f) => f.mimeType === FOLDER_MIME),
          ),
        );
        return;
      }
      setLoading(true);
      const files = await fetchFromApi(id, { signal, canCommit });
      if (!canCommit()) return;
      if (files) {
        setChildren(
          sortFoldersNatural(files.filter((f) => f.mimeType === FOLDER_MIME)),
        );
      }
      setLoading(false);
    },
    [id, fetchFromApi],
  );

  // Load children when expanded
  useEffect(() => {
    if (!isExpanded || children !== null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadChildren(controller.signal);
    return () => controller.abort();
  }, [isExpanded, children, loadChildren]);

  // Re-sync from cache when cache entry changes (e.g. after refresh)
  useEffect(() => {
    if (!isExpanded || !cachedEntry) return;
    setChildren(
      sortFoldersNatural(
        cachedEntry.files.filter((f) => f.mimeType === FOLDER_MIME),
      ),
    );
  }, [isExpanded, cachedEntry]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!hasChildren) return;
      toggle(id);
    },
    [id, hasChildren, toggle],
  );

  const path = useMemo(
    () => [...ancestors, { id, name }],
    [ancestors, id, name],
  );

  const handleSelect = useCallback(() => {
    onSelect(path);
    toggle(id);
  }, [path, onSelect, toggle, id]);

  return (
    <div>
      <FolderTreeRow
        className={cn(
          // Tree rows are stacked edge to edge, so the row grows with real
          // padding on touch (44px = 12 + 20 line-box + 12) instead of an
          // overlay that would reach into the rows above and below.
          "group flex cursor-pointer items-center gap-1 rounded-md py-1 pointer-coarse:py-3 pr-2 text-sm transition-colors hover:bg-accent/50",
          isSelected && "bg-primary/10 text-primary font-medium",
        )}
        depth={depth}
        onSelect={handleSelect}
        expanded={isExpanded}
        selected={isSelected}
      >
        {/* The expander grows to the full row height on touch but keeps its
            20px width: a 44px-wide hit area would reach across the folder
            icon and name, so tapping the label would toggle instead of
            select. Selecting the row expands it anyway, so the expander is a
            shortcut rather than the only way in. */}
        <span className="flex size-5 shrink-0 items-center justify-center pointer-coarse:h-11">
          {loading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : hasChildren ? (
            <button
              type="button"
              className="flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent pointer-coarse:h-11"
              onClick={handleToggle}
              tabIndex={-1}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              <ChevronRight
                className={cn(
                  "size-3 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            </button>
          ) : null}
        </span>
        {isPlayingAncestor ? (
          <NowPlayingBars
            className="size-4 shrink-0 text-primary"
            paused={!isPlaying}
          />
        ) : (
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", isPlayingAncestor && "text-primary")}>
          {name}
        </span>
      </FolderTreeRow>
      {isExpanded && children && children.length > 0 && (
        <div className="animate-in fade-in duration-150">
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              id={child.id}
              name={child.name}
              depth={depth + 1}
              ancestors={path}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
