"use client";

import {
  ArrowLeft,
  Check,
  Download,
  Ellipsis,
  ListMusic,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { PlaylistTrackItem } from "@/components/playlist-track-item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { playlistTrackToDriveFile } from "@/lib/audio";
import { offlineDownloadManager } from "@/lib/offline-download-manager";
import { isPlaylistFull, MAX_TRACKS_PER_PLAYLIST } from "@/lib/playlist-limits";
import { cn, formatRelativeDate } from "@/lib/utils";
import { useLibraryStore } from "@/stores/library-store";
import { useOfflineStore } from "@/stores/offline-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DriveFile, TrackCollection } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

interface PlaylistViewProps {
  collection: TrackCollection;
  onBack?: () => void;
}

function tracksToFiles(collection: TrackCollection): DriveFile[] {
  return collection.tracks.map(playlistTrackToDriveFile);
}

function getCollectionRemoveLabel(collectionId: string) {
  if (collectionId === FAVORITES_COLLECTION_ID) {
    return "Remove from favorites";
  }

  if (collectionId === RECENTLY_PLAYED_COLLECTION_ID) {
    return "Remove from recently played";
  }

  return "Remove from playlist";
}

function getEmptyStateDescription(collectionId: string) {
  if (collectionId === FAVORITES_COLLECTION_ID) {
    return "Use the heart button on any track to save it here";
  }

  if (collectionId === RECENTLY_PLAYED_COLLECTION_ID) {
    return "Tracks appear here after you spend a bit of time listening";
  }

  return "Use the + button on file rows to add songs";
}

// --- Drag-reorder logic isolated in a hook, driven by refs to avoid per-mousemove renders ---

interface DragState {
  fromIndex: number | null;
  overIndex: number | null;
  position: "above" | "below" | null;
}

const EMPTY_DRAG: DragState = {
  fromIndex: null,
  overIndex: null,
  position: null,
};

function useTrackDrag(
  listRef: React.RefObject<HTMLDivElement | null>,
  onReorder: (from: number, to: number) => void,
) {
  const dragRef = useRef<DragState>({ ...EMPTY_DRAG });
  // Rendered state — only updated when the visual indicator needs to change
  const [drag, setDrag] = useState<DragState>(EMPTY_DRAG);

  const getItemIndex = useCallback((el: HTMLElement): number | null => {
    const row = el.closest("[data-track-index]") as HTMLElement | null;
    if (!row) return null;
    const idx = Number(row.dataset.trackIndex);
    return Number.isFinite(idx) ? idx : null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only start drag from the grip handle
      const handle = (e.target as HTMLElement).closest("[data-drag-handle]");
      if (!handle) return;

      const idx = getItemIndex(e.target as HTMLElement);
      if (idx === null) return;

      const listEl = listRef.current;
      if (!listEl) return;

      const row = (e.target as HTMLElement).closest(
        "[data-track-index]",
      ) as HTMLElement;
      const startY = e.clientY;
      const pointerId = e.pointerId;

      // Capture pointer on the list so we get all move/up events
      listEl.setPointerCapture(pointerId);

      let started = false;
      const cur = dragRef.current;

      const onMove = (ev: PointerEvent) => {
        if (!started) {
          // Dead-zone: require 4px movement before starting drag
          if (Math.abs(ev.clientY - startY) < 4) return;
          started = true;
          cur.fromIndex = idx;
          row.style.opacity = "0.3";
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
        }

        // Determine which row we're over
        const items = listEl.querySelectorAll("[data-track-index]");
        let overIdx: number | null = null;
        let pos: "above" | "below" = "below";

        for (const item of items) {
          const rect = item.getBoundingClientRect();
          if (ev.clientY >= rect.top && ev.clientY < rect.bottom) {
            overIdx = Number((item as HTMLElement).dataset.trackIndex);
            pos = ev.clientY < rect.top + rect.height / 2 ? "above" : "below";
            break;
          }
        }

        if (overIdx !== null && overIdx !== cur.fromIndex) {
          if (overIdx !== cur.overIndex || pos !== cur.position) {
            cur.overIndex = overIdx;
            cur.position = pos;
            setDrag({ ...cur });
          }
        } else if (cur.overIndex !== null) {
          cur.overIndex = null;
          cur.position = null;
          setDrag({ ...cur });
        }
      };

      const onUp = () => {
        listEl.removeEventListener("pointermove", onMove);
        listEl.removeEventListener("pointerup", onUp);
        listEl.removeEventListener("pointercancel", onUp);

        try {
          listEl.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }

        row.style.opacity = "";
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        if (started && cur.fromIndex !== null && cur.overIndex !== null) {
          let toIndex =
            cur.position === "above" ? cur.overIndex : cur.overIndex + 1;
          if (cur.fromIndex < toIndex) toIndex--;
          if (cur.fromIndex !== toIndex) {
            onReorder(cur.fromIndex, toIndex);
          }
        }

        dragRef.current = { ...EMPTY_DRAG };
        setDrag(EMPTY_DRAG);
      };

      listEl.addEventListener("pointermove", onMove);
      listEl.addEventListener("pointerup", onUp);
      listEl.addEventListener("pointercancel", onUp);
    },
    [listRef, getItemIndex, onReorder],
  );

  return { drag, onPointerDown };
}

// --- Component ---

export function PlaylistView({ collection, onBack }: PlaylistViewProps) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const pendingTrackId = usePlayerStore((s) => s.pendingTrackId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playingPlaylistId = usePlayerStore((s) => s.playingPlaylistId);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const playerBarPadding = usePlayerBarPadding();

  const removeTrack = usePlaylistStore((s) => s.removeTrack);
  const reorderTracks = usePlaylistStore((s) => s.reorderTracks);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const setFavorite = useLibraryStore((s) => s.setFavorite);
  const removeFromRecent = useLibraryStore((s) => s.removeFromRecent);
  const clearRecent = useLibraryStore((s) => s.clearRecent);

  const offlineCollection = useOfflineStore(
    (s) => s.collections[collection.id],
  );
  const offlineTrackJobs = useOfflineStore((s) => s.trackJobs);
  const isOfflineEnabled = !!offlineCollection?.enabled;
  const allDownloaded =
    isOfflineEnabled &&
    offlineCollection.downloadedCount > 0 &&
    offlineCollection.downloadedCount === offlineCollection.totalCount;
  const failedCount = isOfflineEnabled
    ? offlineCollection.trackFileIds.filter(
        (id) => offlineTrackJobs[id]?.status === "failed",
      ).length
    : 0;
  const hasActiveDownloads = isOfflineEnabled
    ? offlineCollection.trackFileIds.some((id) => {
        const status = offlineTrackJobs[id]?.status;
        return status === "downloading" || status === "updating";
      })
    : false;
  const downloadProgress = offlineCollection?.totalCount
    ? offlineCollection.downloadedCount / offlineCollection.totalCount
    : 0;
  const [offlineToggling, setOfflineToggling] = useState(false);
  const offlineTogglingRef = useRef(false);
  const [removeDownloadsOpen, setRemoveDownloadsOpen] = useState(false);

  const handleOfflineToggle = useCallback(async () => {
    if (offlineTogglingRef.current) return;
    if (allDownloaded) {
      setRemoveDownloadsOpen(true);
      return;
    }
    offlineTogglingRef.current = true;
    setOfflineToggling(true);
    try {
      if (isOfflineEnabled) {
        await offlineDownloadManager.retryDownloads(collection.id);
      } else {
        await offlineDownloadManager.ensureCollectionAvailableOffline(
          collection.id,
        );
      }
    } finally {
      offlineTogglingRef.current = false;
      setOfflineToggling(false);
    }
  }, [collection.id, isOfflineEnabled, allDownloaded]);

  const handleRemoveDownloads = useCallback(async () => {
    if (offlineTogglingRef.current) return;
    offlineTogglingRef.current = true;
    setOfflineToggling(true);
    setRemoveDownloadsOpen(false);
    try {
      await offlineDownloadManager.removeCollectionDownloads(collection.id);
    } finally {
      offlineTogglingRef.current = false;
      setOfflineToggling(false);
    }
  }, [collection.id]);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const isEditablePlaylist =
    collection.id !== FAVORITES_COLLECTION_ID &&
    collection.id !== RECENTLY_PLAYED_COLLECTION_ID;
  const isFullEditablePlaylist =
    isEditablePlaylist && isPlaylistFull(collection.tracks.length);

  const handleReorder = useCallback(
    (from: number, to: number) => {
      if (!isEditablePlaylist) return;
      void reorderTracks(collection.id, from, to);
    },
    [collection.id, isEditablePlaylist, reorderTracks],
  );

  const { drag, onPointerDown } = useTrackDrag(listRef, handleReorder);

  const playFromPlaylist = useCallback(
    (index: number) => {
      const files = tracksToFiles(collection);
      void playTrack(files[index], files, [], collection.id);
    },
    [collection, playTrack],
  );

  const handlePlayAll = useCallback(() => {
    if (collection.tracks.length === 0) return;
    playFromPlaylist(0);
  }, [collection.tracks.length, playFromPlaylist]);

  const handleRename = useCallback(() => {
    const name = editName.trim();
    if (name && isEditablePlaylist) {
      void renamePlaylist(collection.id, name);
    }
    setEditing(false);
  }, [collection.id, editName, isEditablePlaylist, renamePlaylist]);

  const handleDelete = useCallback(async () => {
    if (!isEditablePlaylist) return;
    await offlineDownloadManager.removeCollectionDownloads(collection.id);
    await deletePlaylist(collection.id);
    setActivePlaylist(null);
    setDeleteOpen(false);
  }, [collection.id, deletePlaylist, isEditablePlaylist, setActivePlaylist]);

  const handleRemoveTrack = useCallback(
    (fileId: string, fileName: string) => {
      if (collection.id === FAVORITES_COLLECTION_ID) {
        const track = collection.tracks.find((item) => item.fileId === fileId);
        void setFavorite(
          {
            fileId,
            fileName,
            mimeType: track?.mimeType,
            size: track?.size,
            modifiedTime: track?.modifiedTime,
            parents: track?.parents,
            parentFolderName: track?.parentFolderName,
          },
          false,
        );
        return;
      }

      if (collection.id === RECENTLY_PLAYED_COLLECTION_ID) {
        removeFromRecent(fileId);
        return;
      }

      void removeTrack(collection.id, fileId);
    },
    [
      collection.id,
      collection.tracks,
      removeFromRecent,
      removeTrack,
      setFavorite,
    ],
  );

  const activeTrackId = pendingTrackId ?? currentTrack?.id;
  const isPlayingThisPlaylist = playingPlaylistId === collection.id;
  const isRecentlyPlayed = collection.id === RECENTLY_PLAYED_COLLECTION_ID;

  return (
    <div className="mx-auto flex h-full min-w-0 flex-col overflow-hidden px-4 pt-7">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {onBack && (
          <IconTooltip label="Back to playlists">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              aria-label="Back to playlists"
              className="text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
            </Button>
          </IconTooltip>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {editing && isEditablePlaylist ? (
            <input
              ref={editRef}
              type="text"
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-lg font-semibold outline-none focus:ring-2 focus:ring-ring/50"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={handleRename}
            />
          ) : (
            <h1 className="min-w-0 truncate text-lg font-semibold">
              {collection.name}
            </h1>
          )}
        </div>
        {/* gap-3 on touch: these are 32px icon buttons whose hit areas expand
            to 44px, so they need 44px between centres to stay separable. */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1 pointer-coarse:gap-3">
          {collection.id !== RECENTLY_PLAYED_COLLECTION_ID && (
            <div className="flex items-center gap-1 pointer-coarse:gap-3">
              <IconTooltip
                label={
                  failedCount > 0
                    ? `${offlineCollection.downloadedCount}/${offlineCollection.totalCount} downloaded · ${failedCount} failed`
                    : allDownloaded
                      ? "Remove downloads"
                      : isOfflineEnabled
                        ? `Resume downloads · ${offlineCollection.downloadedCount}/${offlineCollection.totalCount} downloaded`
                        : "Download for offline"
                }
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "relative text-muted-foreground",
                    allDownloaded && "text-emerald-500",
                  )}
                  onClick={handleOfflineToggle}
                  disabled={offlineToggling || collection.tracks.length === 0}
                  aria-label={
                    allDownloaded
                      ? "Remove downloads"
                      : failedCount > 0
                        ? `Retry failed downloads, ${offlineCollection.downloadedCount} of ${offlineCollection.totalCount} downloaded, ${failedCount} failed`
                        : isOfflineEnabled
                          ? `Resume downloads, ${offlineCollection.downloadedCount} of ${offlineCollection.totalCount} downloaded`
                          : "Download for offline"
                  }
                >
                  {isOfflineEnabled &&
                    !allDownloaded &&
                    !offlineToggling &&
                    offlineCollection.totalCount > 0 && (
                      <svg
                        aria-hidden="true"
                        className="absolute inset-0 size-full -rotate-90"
                        viewBox="0 0 32 32"
                      >
                        <circle
                          cx="16"
                          cy="16"
                          r="13"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeOpacity="0.15"
                        />
                        <circle
                          cx="16"
                          cy="16"
                          r="13"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray={2 * Math.PI * 13}
                          strokeDashoffset={
                            2 * Math.PI * 13 * (1 - downloadProgress)
                          }
                          strokeLinecap="round"
                          className="text-primary transition-[stroke-dashoffset] duration-300"
                        />
                      </svg>
                    )}
                  {offlineToggling ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isOfflineEnabled && !allDownloaded ? (
                    <RotateCcw className="size-4" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {allDownloaded && (
                    <Check className="absolute top-0.5 right-0.5 size-2.5 text-emerald-500" />
                  )}
                  {failedCount > 0 && !allDownloaded && (
                    <span className="absolute top-0 right-0.5 text-[9px] font-bold leading-none text-amber-500">
                      !
                    </span>
                  )}
                </Button>
              </IconTooltip>
              {isOfflineEnabled && !allDownloaded && (
                <>
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      failedCount > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {offlineCollection.downloadedCount}/
                    {offlineCollection.totalCount}
                    {failedCount > 0 && "!"}
                  </span>
                  <IconTooltip label="Remove downloads">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setRemoveDownloadsOpen(true)}
                      disabled={offlineToggling}
                      aria-label="Remove downloads"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </IconTooltip>
                </>
              )}
            </div>
          )}
          <Button
            size="sm"
            onClick={handlePlayAll}
            disabled={collection.tracks.length === 0}
          >
            <Play className="size-3.5" />
            Play All
          </Button>
          {collection.id === RECENTLY_PLAYED_COLLECTION_ID && (
            <>
              <div className="h-4 w-px bg-border/60" />
              <IconTooltip label="Clear recently played">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={clearRecent}
                  aria-label="Clear recently played"
                >
                  <Trash2 className="size-4" />
                </Button>
              </IconTooltip>
            </>
          )}
          {isEditablePlaylist && (
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label="Playlist options"
                  />
                }
              >
                <Ellipsis className="size-4" />
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-44">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditName(collection.name);
                    setEditing(true);
                    setTimeout(() => editRef.current?.focus(), 0);
                  }}
                >
                  <Pencil className="size-3.5" />
                  Rename
                </button>
                <div className="my-1 h-px bg-border/60" />
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </button>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      {hasActiveDownloads && (
        <div
          className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          Downloads continue while DriveBeats is open. iOS may pause them in the
          background; they will resume when you return.
        </div>
      )}

      {isFullEditablePlaylist && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            This playlist has reached the {MAX_TRACKS_PER_PLAYLIST}-song limit.
          </span>
        </div>
      )}

      {collection.tracks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-start">
          <div className="w-full">
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ListMusic className="size-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold tracking-tight">No tracks yet</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {getEmptyStateDescription(collection.id)}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
          <div className={cn("min-w-0", playerBarPadding)}>
            <div
              ref={listRef}
              className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-xs"
              onPointerDown={onPointerDown}
            >
              <div className="flex min-w-0 h-11 items-center border-b px-4">
                <span className="text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground">
                  Name
                </span>
              </div>
              {collection.tracks.map((track, index) => {
                const lastPlayedAt = isRecentlyPlayed
                  ? libraryTracks[track.fileId]?.lastPlayedAt
                  : undefined;
                return (
                  <div
                    key={track.fileId}
                    className="border-b last:border-b-0"
                    style={{
                      contentVisibility: "auto",
                      containIntrinsicSize: "auto 52px",
                    }}
                  >
                    <PlaylistTrackItem
                      track={track}
                      index={index}
                      isActive={
                        isPlayingThisPlaylist && activeTrackId === track.fileId
                      }
                      isCurrentlyPlaying={
                        isPlayingThisPlaylist &&
                        currentTrack?.id === track.fileId
                      }
                      isPlaying={isPlaying}
                      subtitle={
                        lastPlayedAt
                          ? formatRelativeDate(lastPlayedAt)
                          : undefined
                      }
                      isDragging={drag.fromIndex === index}
                      dropIndicator={
                        drag.overIndex === index ? drag.position : null
                      }
                      isReorderable={isEditablePlaylist}
                      offlineJob={
                        isOfflineEnabled
                          ? offlineTrackJobs[track.fileId]
                          : undefined
                      }
                      onPlay={() =>
                        isPlayingThisPlaylist &&
                        currentTrack?.id === track.fileId
                          ? togglePlay()
                          : playFromPlaylist(index)
                      }
                      onRemove={() =>
                        handleRemoveTrack(track.fileId, track.fileName)
                      }
                      removeLabel={getCollectionRemoveLabel(collection.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      )}

      <Dialog
        open={isEditablePlaylist ? deleteOpen : false}
        onOpenChange={setDeleteOpen}
      >
        <DialogContent>
          <DialogTitle>Delete playlist</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{collection.name}&rdquo;?
            This cannot be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removeDownloadsOpen} onOpenChange={setRemoveDownloadsOpen}>
        <DialogContent>
          <DialogTitle>Remove downloads</DialogTitle>
          <DialogDescription>
            Remove this playlist&apos;s offline files from this device? Tracks
            shared with another offline collection will stay downloaded.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRemoveDownloads}
            >
              Remove downloads
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
