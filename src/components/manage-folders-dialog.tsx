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
  const removeRootFolder = useImportedDriveStore(
    (state) => state.removeRootFolder,
  );

  const folders = useMemo(
    () =>
      sortFoldersNatural(
        rootFolders.filter((folder) => folder.mimeType === FOLDER_MIME),
      ),
    [rootFolders],
  );

  const handleRemove = (id: string) => {
    removeRootFolder(id);
    useFolderCacheStore.getState().invalidate(id);
    onFolderRemoved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Remove folders</DialogTitle>
        <DialogDescription>
          Folders are only removed from Drivebeats. Your files in Google Drive
          are not changed.
        </DialogDescription>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-md border">
          {folders.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No imported folders.
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
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${folder.name}`}
                    onClick={() => handleRemove(folder.id)}
                  >
                    <Trash2 className="size-4" />
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
