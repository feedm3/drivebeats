"use client";

import { ArrowLeft, HardDrive, Loader2, Trash2, UserX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { logoutAndRedirect } from "@/lib/clear-local-data";
import { deleteAllCloudLibraryData } from "@/lib/cloud-library-api";
import * as offlineDb from "@/lib/offline-db";
import { removeAllDownloads } from "@/lib/offline-download-manager";
import { formatBytes } from "@/lib/utils";
import { getFavoriteTracks, useLibraryStore } from "@/stores/library-store";
import { usePlaylistStore } from "@/stores/playlist-store";

type View = "main" | "confirm-downloads" | "confirm-cloud" | "confirm-account";

interface StorageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StorageDialog({ open, onOpenChange }: StorageDialogProps) {
  const [view, setView] = useState<View>("main");
  const [trackCount, setTrackCount] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const [deletingCloudData, setDeletingCloudData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const playlists = usePlaylistStore((state) => state.playlists);
  const libraryTracks = useLibraryStore((state) => state.tracks);
  const favoriteCount = getFavoriteTracks(libraryTracks).length;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setView("main");
      onOpenChange(next);
    },
    [onOpenChange],
  );

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
      setView("main");
    } finally {
      setRemoving(false);
    }
  }, []);

  const handleDeleteCloudData = useCallback(async () => {
    setDeletingCloudData(true);
    try {
      await deleteAllCloudLibraryData();
      usePlaylistStore.getState().clearCloudState();
      usePlaylistStore.persist.clearStorage();
      useLibraryStore.getState().clearCloudFavorites();
      toast.success("Deleted synced playlists and favorites.");
      setView("main");
    } catch (error) {
      console.error("Delete cloud data failed:", error);
      toast.error("Could not delete cloud data.");
    } finally {
      setDeletingCloudData(false);
    }
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    setDeletingAccount(true);
    try {
      await deleteAllCloudLibraryData();
      await logoutAndRedirect();
    } catch (error) {
      console.error("Delete account failed:", error);
      toast.error("Could not delete account. Please try again.");
      setDeletingAccount(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {view === "main" && (
          <>
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="size-4" />
              Storage & data
            </DialogTitle>
            <DialogDescription>
              Device downloads and synced account data.
            </DialogDescription>

            <h3 className="mt-3 text-sm font-semibold">Device</h3>
            <div className="mt-1 space-y-3 text-sm">
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
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setView("confirm-downloads")}
                disabled={trackCount === 0}
              >
                <Trash2 className="size-3.5" />
                Remove all downloads
              </Button>
            </div>

            <h3 className="mt-5 border-t pt-4 text-sm font-semibold">Cloud</h3>
            <div className="mt-1 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Synced playlists</span>
                <span className="font-medium tabular-nums">
                  {playlists.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Synced favorites</span>
                <span className="font-medium tabular-nums">
                  {favoriteCount}
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setView("confirm-cloud")}
                disabled={playlists.length === 0 && favoriteCount === 0}
              >
                <Trash2 className="size-3.5" />
                Delete cloud data
              </Button>
            </div>

            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setView("confirm-account")}
              >
                <UserX className="size-3.5" />
                Delete account
              </Button>
              <DialogClose render={<Button variant="outline" size="sm" />}>
                Close
              </DialogClose>
            </div>
          </>
        )}

        {view === "confirm-downloads" && (
          <>
            <DialogTitle>Remove all downloads?</DialogTitle>
            <DialogDescription>
              This removes {trackCount} downloaded{" "}
              {trackCount === 1 ? "track" : "tracks"} ({formatBytes(totalBytes)}
              ) from this device. You can re-download them later.
            </DialogDescription>
            <div className="mt-4 flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("main")}
                disabled={removing}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemoveAll}
                disabled={removing}
              >
                {removing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Removing downloads...
                  </>
                ) : (
                  "Remove all downloads"
                )}
              </Button>
            </div>
          </>
        )}

        {view === "confirm-cloud" && (
          <>
            <DialogTitle>Delete cloud data?</DialogTitle>
            <DialogDescription>
              This permanently deletes {playlists.length}{" "}
              {playlists.length === 1 ? "playlist" : "playlists"} and{" "}
              {favoriteCount} {favoriteCount === 1 ? "favorite" : "favorites"}{" "}
              from your account. This can't be undone.
            </DialogDescription>
            <div className="mt-4 flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("main")}
                disabled={deletingCloudData}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteCloudData}
                disabled={deletingCloudData}
              >
                {deletingCloudData ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Deleting cloud data...
                  </>
                ) : (
                  "Delete cloud data"
                )}
              </Button>
            </div>
          </>
        )}

        {view === "confirm-account" && (
          <>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="size-4" />
              Delete account
            </DialogTitle>
            <DialogDescription>
              This permanently deletes your DriveBeats data:
            </DialogDescription>
            <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Synced playlists and favorites</li>
              <li>Downloaded tracks on this device</li>
              <li>Saved preferences and cached data</li>
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              You'll be logged out. To also revoke Drive access, remove
              DriveBeats from your{" "}
              <a
                href="https://myaccount.google.com/connections"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Google account connections
              </a>
              .
            </p>
            <div className="mt-4 flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("main")}
                disabled={deletingAccount}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
              >
                {deletingAccount ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete everything"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
