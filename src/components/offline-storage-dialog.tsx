"use client";

import { HardDriveDownload, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOfflineStore } from "@/stores/offline-store";

interface OfflineStorageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OfflineStorageDialog({
  open,
  onOpenChange,
}: OfflineStorageDialogProps) {
  const items = useOfflineStore((state) => state.items);
  const clearAllOfflineData = useOfflineStore((state) => state.clearAllOfflineData);
  const removeOfflineTrack = useOfflineStore((state) => state.removeOfflineTrack);

  const cachedItems = useMemo(
    () => Object.values(items).filter((item) => item.status === "cached"),
    [items],
  );

  const totalSize = useMemo(
    () => cachedItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    [cachedItems],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] sm:max-w-xl">
        <DialogTitle className="flex items-center gap-2">
          <HardDriveDownload className="size-4" />
          Offline storage
        </DialogTitle>
        <DialogDescription>
          {cachedItems.length} songs offline · {formatBytes(totalSize)} used on
          this device.
        </DialogDescription>
        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void clearAllOfflineData()}
            disabled={cachedItems.length === 0}
          >
            Clear all offline songs
          </Button>
        </div>

        <ScrollArea className="max-h-[48vh] rounded-lg border">
          <ul className="divide-y">
            {cachedItems.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No offline songs yet.
              </li>
            ) : (
              cachedItems.map((item) => (
                <li
                  key={item.fileId}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{item.fileName}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatBytes(item.sizeBytes)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void removeOfflineTrack(item.fileId)}
                    aria-label={`Remove offline copy ${item.fileName}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
