"use client";

import { Check, ChevronRight, Folder, Loader2, Minus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useFolderContents } from "@/hooks/use-folder-contents";
import {
  type FolderCheckState,
  getFolderFilterState,
} from "@/lib/folder-tree-visibility";
import { sortFoldersNatural } from "@/lib/sort";
import { cn } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useFolderFilterStore } from "@/stores/folder-filter-store";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

interface FolderFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: DriveFile[];
  loading?: boolean;
}

export function FolderFilterDialog({
  open,
  onOpenChange,
  folders,
  loading = false,
}: FolderFilterDialogProps) {
  const { hiddenFolderIds, hideTree, showTree, showAll } =
    useFolderFilterStore();
  const hasHidden = hiddenFolderIds.size > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between">
          <div>
            <DialogTitle>Filter folders</DialogTitle>
            <DialogDescription>
              Choose which folders appear in the sidebar.
            </DialogDescription>
          </div>
          <IconTooltip label="Close">
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Close"
                />
              }
            >
              <X className="size-4" />
            </DialogClose>
          </IconTooltip>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading folders...
            </div>
          ) : folders.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No folders found.
            </div>
          ) : (
            <div className="space-y-0.5">
              {folders.map((folder) => (
                <FilterFolderNode
                  key={folder.id}
                  id={folder.id}
                  name={folder.name}
                  depth={0}
                  hiddenFolderIds={hiddenFolderIds}
                  hideTree={hideTree}
                  showTree={showTree}
                />
              ))}
            </div>
          )}
        </div>

        {hasHidden && (
          <div className="mt-3 flex shrink-0 justify-end">
            <Button variant="ghost" size="sm" onClick={showAll}>
              Show all
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FilterFolderNodeProps {
  id: string;
  name: string;
  depth: number;
  hiddenFolderIds: Set<string>;
  hideTree: (id: string) => void;
  showTree: (id: string) => void;
}

function FilterFolderNode({
  id,
  name,
  depth,
  hiddenFolderIds,
  hideTree,
  showTree,
}: FilterFolderNodeProps) {
  const cache = useFolderCacheStore((s) => s.cache);
  const cachedEntry = useFolderCacheStore((s) => s.cache.get(id));
  const { fetchFromApi } = useFolderContents();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DriveFile[] | null>(null);
  const [loading, setLoading] = useState(false);

  const state: FolderCheckState = getFolderFilterState(
    id,
    hiddenFolderIds,
    cache,
  );

  const handleToggle = useCallback(() => {
    // unchecked → show all; checked/partial → hide all
    if (state === "unchecked") showTree(id);
    else hideTree(id);
  }, [id, state, hideTree, showTree]);

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

  useEffect(() => {
    if (expanded && children === null) {
      loadChildren();
    }
  }, [expanded, children, loadChildren]);

  // Re-sync from cache
  useEffect(() => {
    if (!expanded || !cachedEntry) return;
    setChildren(
      sortFoldersNatural(
        cachedEntry.files.filter((f) => f.mimeType === FOLDER_MIME),
      ),
    );
  }, [expanded, cachedEntry]);

  const hasChildren = children === null || children.length > 0;

  return (
    <div>
      <div
        className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-sm transition-colors hover:bg-accent"
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {loading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : hasChildren ? (
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded transition-colors hover:bg-accent"
              onClick={() => setExpanded((prev) => !prev)}
              tabIndex={-1}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <ChevronRight
                className={cn(
                  "size-3 text-muted-foreground transition-transform",
                  expanded && "rotate-90",
                )}
              />
            </button>
          ) : null}
        </span>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2"
          onClick={handleToggle}
        >
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
              state === "checked"
                ? "border-primary bg-primary text-primary-foreground"
                : state === "partial"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40",
            )}
          >
            {state === "checked" && <Check className="size-3" />}
            {state === "partial" && <Minus className="size-3" />}
          </span>
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {expanded && children && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FilterFolderNode
              key={child.id}
              id={child.id}
              name={child.name}
              depth={depth + 1}
              hiddenFolderIds={hiddenFolderIds}
              hideTree={hideTree}
              showTree={showTree}
            />
          ))}
        </div>
      )}
    </div>
  );
}
