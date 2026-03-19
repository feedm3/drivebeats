"use client";

import {
  ArrowLeft,
  Download,
  Ellipsis,
  ListMusic,
  Loader2,
  Pencil,
  Play,
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
import {
  startCollectionDownload,
  stopCollectionDownload,
} from "@/lib/offline-download-manager";
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
  const offlineTrackStatus = useOfflineStore((s) => s.trackStatus);
  const isOfflineEnabled = !!offlineCollection?.enabled;
  const [offlineToggling, setOfflineToggling] = useState(false);

  const handleOfflineToggle = useCallback(async () => {
    setOfflineToggling(true);
    try {
      if (isOfflineEnabled) {
        await stopCollectionDownload(collection.id);
      } else {
        await startCollectionDownload(collection.id);
      }
    } finally {
      setOfflineToggling(false);
    }
  }, [collection.id, isOfflineEnabled]);

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
    await stopCollectionDownload(collection.id);
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
    <div className="mx-auto flex h-full flex-col overflow-hidden px-4 pt-7">
      <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={handlePlayAll}
            disabled={collection.tracks.length === 0}
          >
            <Play className="size-3.5" />
            Play All
          </Button>
          {collection.id !== RECENTLY_PLAYED_COLLECTION_ID && (
            <IconTooltip
              label={
                isOfflineEnabled
                  ? offlineCollection.downloadedCount ===
                    offlineCollection.totalCount
                    ? "Remove downloads"
                    : `${offlineCollection.downloadedCount}/${offlineCollection.totalCount} downloaded`
                  : "Available offline"
              }
            >
              <Button
                variant={isOfflineEnabled ? "secondary" : "ghost"}
                size="icon-sm"
                className="text-muted-foreground"
                onClick={handleOfflineToggle}
                disabled={offlineToggling || collection.tracks.length === 0}
                aria-label={
                  isOfflineEnabled ? "Remove downloads" : "Available offline"
                }
              >
                {offlineToggling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download
                    className={cn("size-4", isOfflineEnabled && "text-primary")}
                  />
                )}
              </Button>
            </IconTooltip>
          )}
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

      {isOfflineEnabled &&
        offlineCollection.downloadedCount < offlineCollection.totalCount && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>
              {offlineCollection.downloadedCount}/{offlineCollection.totalCount}{" "}
              downloaded
            </span>
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
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/30">
            <ListMusic className="size-6" />
          </div>
          <span className="text-sm">No tracks yet</span>
          <span className="text-xs">
            {getEmptyStateDescription(collection.id)}
          </span>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className={cn(playerBarPadding)}>
            <div
              ref={listRef}
              className="rounded-2xl border border-border/60 bg-background/80 shadow-xs overflow-hidden touch-none"
              onPointerDown={onPointerDown}
            >
              <div className="flex h-11 items-center border-b px-4">
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
                      offlineStatus={
                        isOfflineEnabled
                          ? offlineTrackStatus[track.fileId]
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
    </div>
  );
}
