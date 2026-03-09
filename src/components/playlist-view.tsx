"use client";

import { ArrowLeft, ListMusic, Pencil, Play, Trash2 } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
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
  return collection.tracks.map((t) => ({
    id: t.fileId,
    name: t.fileName,
    mimeType: "audio/mpeg",
  }));
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
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playingPlaylistId = usePlayerStore((s) => s.playingPlaylistId);
  const playerBarPadding = usePlayerBarPadding();
  const getValidAccessToken = useAuthStore((s) => s.getValidAccessToken);

  const removeTrack = usePlaylistStore((s) => s.removeTrack);
  const reorderTracks = usePlaylistStore((s) => s.reorderTracks);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const setFavorite = useLibraryStore((s) => s.setFavorite);
  const removeFromRecent = useLibraryStore((s) => s.removeFromRecent);
  const clearRecent = useLibraryStore((s) => s.clearRecent);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const isEditablePlaylist =
    collection.id !== FAVORITES_COLLECTION_ID &&
    collection.id !== RECENTLY_PLAYED_COLLECTION_ID;

  const handleReorder = useCallback(
    (from: number, to: number) => {
      if (!isEditablePlaylist) return;
      reorderTracks(collection.id, from, to);
    },
    [collection.id, isEditablePlaylist, reorderTracks],
  );

  const { drag, onPointerDown } = useTrackDrag(listRef, handleReorder);

  const playFromPlaylist = useCallback(
    async (index: number) => {
      const token = await getValidAccessToken();
      if (!token) return;
      const files = tracksToFiles(collection);
      playTrack(files[index], files, token, [], collection.id);
    },
    [collection, playTrack, getValidAccessToken],
  );

  const handlePlayAll = useCallback(() => {
    if (collection.tracks.length === 0) return;
    playFromPlaylist(0);
  }, [collection.tracks.length, playFromPlaylist]);

  const handleRename = useCallback(() => {
    const name = editName.trim();
    if (name && isEditablePlaylist) {
      renamePlaylist(collection.id, name);
    }
    setEditing(false);
  }, [collection.id, editName, isEditablePlaylist, renamePlaylist]);

  const handleDelete = useCallback(() => {
    if (!isEditablePlaylist) return;
    deletePlaylist(collection.id);
    setActivePlaylist(null);
    setDeleteOpen(false);
  }, [collection.id, deletePlaylist, isEditablePlaylist, setActivePlaylist]);

  const handleRemoveTrack = useCallback(
    (fileId: string, fileName: string) => {
      if (collection.id === FAVORITES_COLLECTION_ID) {
        setFavorite({ fileId, fileName }, false);
        return;
      }

      if (collection.id === RECENTLY_PLAYED_COLLECTION_ID) {
        removeFromRecent(fileId);
        return;
      }

      removeTrack(collection.id, fileId);
    },
    [collection.id, removeFromRecent, removeTrack, setFavorite],
  );

  const isPlayingThisPlaylist = playingPlaylistId === collection.id;

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
          {isEditablePlaylist && !editing && (
            <IconTooltip label="Rename playlist">
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground"
                onClick={() => {
                  setEditName(collection.name);
                  setEditing(true);
                  setTimeout(() => editRef.current?.focus(), 0);
                }}
                aria-label="Rename playlist"
              >
                <Pencil className="size-3" />
              </Button>
            </IconTooltip>
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
          {collection.id === RECENTLY_PLAYED_COLLECTION_ID ? (
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
          ) : null}
          {isEditablePlaylist ? (
            <IconTooltip label="Delete playlist">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                aria-label="Delete playlist"
              >
                <Trash2 className="size-4" />
              </Button>
            </IconTooltip>
          ) : null}
        </div>
      </div>

      <Separator className="my-3" />

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
              {collection.tracks.map((track, index) => (
                <PlaylistTrackItem
                  key={track.fileId}
                  track={track}
                  index={index}
                  isActive={
                    isPlayingThisPlaylist && currentTrack?.id === track.fileId
                  }
                  isPlaying={isPlaying}
                  isDragging={drag.fromIndex === index}
                  dropIndicator={
                    drag.overIndex === index ? drag.position : null
                  }
                  isReorderable={isEditablePlaylist}
                  onPlay={() => playFromPlaylist(index)}
                  onRemove={() =>
                    handleRemoveTrack(track.fileId, track.fileName)
                  }
                  removeLabel={getCollectionRemoveLabel(collection.id)}
                />
              ))}
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
