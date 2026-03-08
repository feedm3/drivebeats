"use client";

import { ChevronRight, Folder, Loader2 } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { sortFoldersNatural } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useFolderFilterStore } from "@/stores/folder-filter-store";
import { useFolderTreeStore } from "@/stores/folder-tree-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME } from "@/types";

interface RenderableFolderEntry {
  folder: DriveFile;
  ancestors: FolderEntry[];
  contextLabel?: string;
}

async function collectPromotedFolders({
  folders,
  ancestors,
  hiddenFolderIds,
  loadFolderChildren,
  hiddenPathNames = [],
}: {
  folders: DriveFile[];
  ancestors: FolderEntry[];
  hiddenFolderIds: Set<string>;
  loadFolderChildren: (folderId: string) => Promise<DriveFile[]>;
  hiddenPathNames?: string[];
}): Promise<RenderableFolderEntry[]> {
  const entries: RenderableFolderEntry[] = [];

  for (const folder of folders) {
    if (!hiddenFolderIds.has(folder.id)) {
      entries.push({
        folder,
        ancestors,
        contextLabel:
          hiddenPathNames.length > 0 ? hiddenPathNames.join(" / ") : undefined,
      });
      continue;
    }

    const childFolders = await loadFolderChildren(folder.id);
    if (childFolders.length === 0) continue;

    entries.push(
      ...(await collectPromotedFolders({
        folders: childFolders,
        ancestors: [...ancestors, { id: folder.id, name: folder.name }],
        hiddenFolderIds,
        loadFolderChildren,
        hiddenPathNames: [...hiddenPathNames, folder.name],
      })),
    );
  }

  return entries;
}

interface FolderTreeNodeProps {
  id: string;
  name: string;
  depth: number;
  ancestors: FolderEntry[];
  selectedFolderId: string;
  onSelect: (path: FolderEntry[]) => void;
  contextLabel?: string;
}

interface FolderTreeChildrenProps {
  folders: DriveFile[];
  depth: number;
  ancestors: FolderEntry[];
  selectedFolderId: string;
  onSelect: (path: FolderEntry[]) => void;
  emptyState?: ReactNode;
}

export function FolderTreeNode({
  id,
  name,
  depth,
  ancestors,
  selectedFolderId,
  onSelect,
  contextLabel,
}: FolderTreeNodeProps) {
  const isExpanded = useFolderTreeStore((s) => s.expandedFolders.has(id));
  const toggle = useFolderTreeStore((s) => s.toggle);
  const isHidden = useFolderFilterStore((s) => s.isHidden);

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

  const loadChildren = useCallback(async () => {
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
    const files = await fetchFromApi(id);
    if (files) {
      setChildren(
        sortFoldersNatural(files.filter((f) => f.mimeType === FOLDER_MIME)),
      );
    }
    setLoading(false);
  }, [id, fetchFromApi]);

  // Load children when expanded
  useEffect(() => {
    if (isExpanded && children === null) {
      loadChildren();
    }
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
      if (!isExpanded && children === null) {
        loadChildren();
      }
      toggle(id);
    },
    [id, isExpanded, hasChildren, children, loadChildren, toggle],
  );

  const path = useMemo(
    () => [...ancestors, { id, name }],
    [ancestors, id, name],
  );

  const handleSelect = useCallback(() => {
    onSelect(path);
    if (!isExpanded) {
      if (children === null) {
        loadChildren();
      }
    }
    toggle(id);
  }, [path, onSelect, isExpanded, toggle, id, children, loadChildren]);

  return (
    <div>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-md py-1 pr-2 text-sm transition-colors hover:bg-accent/50",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={handleSelect}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={isSelected}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelect();
          }
        }}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {loading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : hasChildren ? (
            <button
              type="button"
              className="flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent"
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
          <NowPlayingBars className="size-4 shrink-0 text-primary" paused={!isPlaying} />
        ) : (
          <Folder className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate", isPlayingAncestor && "text-primary")}>
            {name}
          </div>
          {contextLabel && (
            <div className="truncate text-[11px] leading-4 text-muted-foreground">
              In {contextLabel}
            </div>
          )}
        </div>
      </div>
      {isExpanded && children && children.length > 0 && (
        <div>
          <FolderTreeChildren
            folders={children}
            depth={depth + 1}
            ancestors={path}
            selectedFolderId={selectedFolderId}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

export function FolderTreeChildren({
  folders,
  depth,
  ancestors,
  selectedFolderId,
  onSelect,
  emptyState,
}: FolderTreeChildrenProps) {
  const hiddenFolderIds = useFolderFilterStore((s) => s.hiddenFolderIds);
  const { fetchFromApi } = useFolderContents();
  const [promotedByHiddenId, setPromotedByHiddenId] = useState<
    Record<string, RenderableFolderEntry[]>
  >({});
  const [loadingPromoted, setLoadingPromoted] = useState(false);

  const sortedFolders = useMemo(() => sortFoldersNatural([...folders]), [folders]);

  const hiddenFolders = useMemo(
    () => sortedFolders.filter((folder) => hiddenFolderIds.has(folder.id)),
    [sortedFolders, hiddenFolderIds],
  );

  const loadFolderChildren = useCallback(
    async (folderId: string) => {
      const cached = useFolderCacheStore.getState().getFiles(folderId);
      if (cached) {
        return sortFoldersNatural(
          cached.files.filter((file) => file.mimeType === FOLDER_MIME),
        );
      }

      const files = await fetchFromApi(folderId);
      return sortFoldersNatural(
        (files ?? []).filter((file) => file.mimeType === FOLDER_MIME),
      );
    },
    [fetchFromApi],
  );

  useEffect(() => {
    if (hiddenFolders.length === 0) {
      setPromotedByHiddenId({});
      setLoadingPromoted(false);
      return;
    }

    let cancelled = false;
    setLoadingPromoted(true);

    const loadPromotedFolders = async () => {
      const next: Record<string, RenderableFolderEntry[]> = {};

      for (const folder of hiddenFolders) {
        next[folder.id] = await collectPromotedFolders({
          folders: [folder],
          ancestors,
          hiddenFolderIds,
          loadFolderChildren,
        });
      }

      if (!cancelled) {
        setPromotedByHiddenId(next);
        setLoadingPromoted(false);
      }
    };

    void loadPromotedFolders();

    return () => {
      cancelled = true;
    };
  }, [ancestors, hiddenFolderIds, hiddenFolders, loadFolderChildren]);

  const renderableFolders = useMemo(() => {
    const entries: RenderableFolderEntry[] = [];

    for (const folder of sortedFolders) {
      if (!hiddenFolderIds.has(folder.id)) {
        entries.push({ folder, ancestors });
        continue;
      }

      entries.push(...(promotedByHiddenId[folder.id] ?? []));
    }

    return entries;
  }, [ancestors, hiddenFolderIds, promotedByHiddenId, sortedFolders]);

  if (renderableFolders.length === 0) {
    if (loadingPromoted) {
      return (
        <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading visible folders...
        </div>
      );
    }

    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <>
      {renderableFolders.map(({ folder, ancestors: nodeAncestors, contextLabel }) => (
        <FolderTreeNode
          key={`${folder.id}-${nodeAncestors[nodeAncestors.length - 1]?.id ?? "root"}`}
          id={folder.id}
          name={folder.name}
          depth={depth}
          ancestors={nodeAncestors}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
          contextLabel={contextLabel}
        />
      ))}
    </>
  );
}
