"use client";

import { HardDrive, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { removeAllDownloads } from "@/lib/offline-download-manager";
import * as offlineDb from "@/lib/offline-db";
import { formatBytes } from "@/lib/utils";

interface OfflineStorageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OfflineStorageDialog({
  open,
  onOpenChange,
}: OfflineStorageDialogProps) {
  const [trackCount, setTrackCount] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const [sizes, count] = await Promise.all([
        offlineDb.getAllTrackSizes(),
        offlineDb.getTrackCount(),
      ]);
      setTrackCount(count);
      setTotalBytes(sizes.reduce((sum, s) => sum + s.sizeBytes, 0));
    } catch {
      // IndexedDB unavailable
    }

    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (est.quota != null && est.usage != null) {
          setQuota({ usage: est.usage, quota: est.quota });
        }
      } catch {
        // estimate unavailable
      }
    }
  }, []);

  useEffect(() => {
    if (open) void loadStats();
  }, [open, loadStats]);

  const handleRemoveAll = useCallback(async () => {
    setRemoving(true);
    try {
      await removeAllDownloads();
      setTrackCount(0);
      setTotalBytes(0);
      onOpenChange(false);
    } finally {
      setRemoving(false);
    }
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-2">
          <HardDrive className="size-4" />
          Offline storage
        </DialogTitle>
        <DialogDescription>
          Manage downloaded tracks stored on this device.
        </DialogDescription>

        <div className="mt-2 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Downloaded tracks</span>
            <span className="font-medium tabular-nums">{trackCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Storage used</span>
            <span className="font-medium tabular-nums">
              {formatBytes(totalBytes)}
            </span>
          </div>
          {quota && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Browser quota</span>
              <span className="font-medium tabular-nums">
                {formatBytes(quota.usage)} / {formatBytes(quota.quota)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleRemoveAll}
            disabled={removing || trackCount === 0}
          >
            {removing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Removing...
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" />
                Remove all downloads
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
