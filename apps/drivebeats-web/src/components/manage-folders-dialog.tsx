"use client";

import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { sortFoldersNatural } from "@/lib/sort";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { FOLDER_MIME } from "@/types";

interface ManageFoldersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFolderRemoved?: () => void;
}

export function ManageFoldersDialog({
  open,
  onOpenChange,
  onFolderRemoved,
}: ManageFoldersDialogProps) {
  const rootFolders = useImportedDriveStore((state) => state.rootFolders);
  const rootFiles = useImportedDriveStore((state) => state.rootFiles);
  const removeRootFile = useImportedDriveStore((state) => state.removeRootFile);
  const removeRootFolder = useImportedDriveStore(
    (state) => state.removeRootFolder,
  );

  const folders = useMemo(
    () =>
      sortFoldersNatural([
        ...rootFolders.filter((folder) => folder.mimeType === FOLDER_MIME),
        ...rootFiles,
      ]),
    [rootFolders, rootFiles],
  );

  const handleRemove = (id: string, isFolder: boolean) => {
    if (isFolder) {
      removeRootFolder(id);
      useFolderCacheStore.getState().invalidate(id);
    } else removeRootFile(id);
    onFolderRemoved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Remove Library items</DialogTitle>
        <DialogDescription>
          Removing an Imported Folder or Standalone Track removes that Library
          choice on every device. Your music files and existing downloads stay
          unchanged.
        </DialogDescription>

        {/* No inner scroller: DialogContent already caps its own height and
            scrolls, and nesting the two strands the list on short viewports. */}
        <div className="mt-4 rounded-md border">
          {folders.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No Imported Folders or Standalone Tracks.
            </div>
          ) : (
            <ul className="divide-y">
              {folders.map((folder) => (
                <li
                  key={folder.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {folder.name}
                    </div>
                    {folder.parentFolderName && (
                      <div className="truncate text-xs text-muted-foreground">
                        {folder.parentFolderName}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="min-h-11 min-w-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${folder.name}`}
                    onClick={() =>
                      handleRemove(folder.id, folder.mimeType === FOLDER_MIME)
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Done
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
