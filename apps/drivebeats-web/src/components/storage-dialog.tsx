"use client";

import {
  ArrowLeft,
  Cloud,
  HardDrive,
  Loader2,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UserX,
} from "lucide-react";
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
import {
  getMetadataCacheUsage,
  type MetadataCacheUsage,
} from "@/lib/metadata-cache-usage";
import * as offlineDb from "@/lib/offline-db";
import { offlineDownloadManager } from "@/lib/offline-download-manager";
import { formatBytes } from "@/lib/utils";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useLibrarySearchStore } from "@/stores/library-search-store";
import { getFavoriteTracks, useLibraryStore } from "@/stores/library-store";
import { useOfflineStore } from "@/stores/offline-store";
import { usePlaylistStore } from "@/stores/playlist-store";

type View = "main" | "confirm-downloads" | "confirm-account";

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
  const [retrying, setRetrying] = useState(false);
  const [metadataUsage, setMetadataUsage] = useState<MetadataCacheUsage | null>(
    null,
  );
  const [checkingMetadata, setCheckingMetadata] = useState(false);
  const metadataAccount = useId3MetadataStore((state) => state.accountId);
  const metadataGeneration = useId3MetadataStore((state) => state.generation);
  const metadataHydrated = useId3MetadataStore((state) => state.hydrated);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const trackJobs = useOfflineStore((state) => state.trackJobs);
  const offlineCollections = useOfflineStore((state) => state.collections);
  const storagePersistence = useOfflineStore(
    (state) => state.storagePersistence,
  );
  const playlists = usePlaylistStore((state) => state.playlists);
  const libraryTracks = useLibraryStore((state) => state.tracks);
  const favoriteCount = getFavoriteTracks(libraryTracks).length;
  const failedJobs = Object.values(trackJobs).filter(
    (job) => job.status === "failed",
  );
  const hasStorageFullFailure = failedJobs.some(
    (job) => job.errorCategory === "storage-full",
  );
  const hasStorageUnavailableFailure = failedJobs.some(
    (job) => job.errorCategory === "storage-unavailable",
  );
  const hasOfflineData =
    (metadataUsage?.recordCount ?? 0) > 0 ||
    trackCount > 0 ||
    Object.keys(trackJobs).length > 0 ||
    Object.keys(offlineCollections).length > 0;

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
    if (open) {
      void loadStats();
    }
  }, [open, loadStats]);

  useEffect(() => {
    if (!open || !metadataAccount) {
      setMetadataUsage(null);
      setCheckingMetadata(false);
      return;
    }
    if (!metadataHydrated) {
      setMetadataUsage(null);
      setCheckingMetadata(true);
      return;
    }
    const controller = new AbortController();
    setMetadataUsage(null);
    setCheckingMetadata(true);
    void getMetadataCacheUsage(metadataAccount, controller.signal)
      .then((usage) => {
        const current = useId3MetadataStore.getState();
        if (
          !controller.signal.aborted &&
          current.accountId === metadataAccount &&
          current.generation === metadataGeneration
        ) {
          setMetadataUsage(usage);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setCheckingMetadata(false);
      });
    return () => controller.abort();
  }, [open, metadataAccount, metadataGeneration, metadataHydrated]);

  const handleRemoveAll = useCallback(async () => {
    setRemoving(true);
    try {
      await offlineDownloadManager.removeAllDownloads();
      await useLibrarySearchStore.getState().clear();
      setTrackCount(0);
      setTotalBytes(0);
      setView("main");
      toast.success("Downloads and music metadata removed.");
    } catch {
      toast.error("Could not remove all local data. Please try again.");
    } finally {
      setRemoving(false);
    }
  }, []);

  const handleRetryFailed = useCallback(async () => {
    setRetrying(true);
    try {
      await offlineDownloadManager.retryDownloads();
      toast.success("Retrying failed downloads.");
    } catch {
      toast.error("Could not retry downloads.");
    } finally {
      setRetrying(false);
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
      <DialogContent className="w-[calc(100%_-_2rem)] [&_button]:min-h-11 [&_button]:min-w-11">
        {view === "main" && (
          <>
            <DialogTitle>Storage & data</DialogTitle>
            <DialogDescription>
              Device downloads, music metadata and synced account data.
            </DialogDescription>

            <h3 className="mt-4 flex items-center gap-2 text-sm font-semibold tracking-tight">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <HardDrive className="size-3.5" />
              </span>
              Device
            </h3>
            <div className="mt-1 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Downloaded tracks</span>
                <span className="font-medium tabular-nums">{trackCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Download storage</span>
                <span className="font-medium tabular-nums">
                  {formatBytes(totalBytes)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Music metadata</span>
                <span className="font-medium tabular-nums">
                  {checkingMetadata
                    ? "Checking…"
                    : metadataUsage
                      ? formatBytes(metadataUsage.approximateBytes)
                      : "Unavailable"}
                </span>
              </div>
              {quota && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Browser storage usage
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatBytes(quota.usage)} / {formatBytes(quota.quota)}
                  </span>
                </div>
              )}
              {trackCount > 0 && storagePersistence !== "granted" ? (
                <p className="text-pretty text-muted-foreground">
                  Your browser may remove downloads when space is low. You can
                  download them again.
                </p>
              ) : null}

              {(hasStorageFullFailure || hasStorageUnavailableFailure) && (
                <div
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-100"
                  role="alert"
                >
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-medium">
                        {hasStorageFullFailure
                          ? "Not enough device storage"
                          : "Offline storage is unavailable"}
                      </p>
                      <p className="mt-0.5 text-xs">
                        {hasStorageFullFailure
                          ? "Free device storage or remove downloads, then retry the failed tracks."
                          : "Reopen DriveBeats. If the problem continues, remove downloads and retry."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryFailed}
                  disabled={retrying || failedJobs.length === 0}
                >
                  {retrying ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Retry failed downloads
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setView("confirm-downloads")}
                  disabled={!hasOfflineData || checkingMetadata}
                >
                  <Trash2 className="size-3.5" />
                  Remove all downloads
                </Button>
              </div>
            </div>

            <h3 className="mt-5 flex items-center gap-2 border-t pt-4 text-sm font-semibold tracking-tight">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Cloud className="size-3.5" />
              </span>
              Cloud
            </h3>
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
              This removes all offline download settings and {trackCount}{" "}
              downloaded {trackCount === 1 ? "track" : "tracks"} (
              {formatBytes(totalBytes)}) from this device, plus cached music
              metadata. Downloads can be saved again; metadata rebuilds
              automatically.
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
