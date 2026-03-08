"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderTreeNode } from "@/components/folder-tree-node";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFolderContents } from "@/hooks/use-folder-contents";
import { sortFoldersNatural } from "@/lib/sort";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

interface FolderTreeProps {
  selectedFolderId: string;
  onSelectFolder: (path: FolderEntry[]) => void;
}

export function FolderTree({
  selectedFolderId,
  onSelectFolder,
}: FolderTreeProps) {
  const { fetchFromApi } = useFolderContents();
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);
  const [rootFolders, setRootFolders] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);

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
      <div className="shrink-0 px-4 pt-8 pb-2">
        <h2 className="text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground">
          Folders
        </h2>
      </div>
      <ScrollArea className="flex-1 px-2 pb-4">
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
      </ScrollArea>
    </div>
  );
}
