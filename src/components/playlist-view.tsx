"use client";

import { ArrowLeft, ListMusic, Pencil, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaylistTrackItem } from "@/components/playlist-track-item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DriveFile, Playlist } from "@/types";

interface PlaylistViewProps {
  playlist: Playlist;
  onBack?: () => void;
}

function tracksToFiles(playlist: Playlist): DriveFile[] {
  return playlist.tracks.map((t) => ({
    id: t.fileId,
    name: t.fileName,
    mimeType: "audio/mpeg",
  }));
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

export function PlaylistView({ playlist, onBack }: PlaylistViewProps) {
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

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  const handleReorder = useCallback(
    (from: number, to: number) => {
      reorderTracks(playlist.id, from, to);
    },
    [playlist.id, reorderTracks],
  );

  const { drag, onPointerDown } = useTrackDrag(listRef, handleReorder);

  const playFromPlaylist = useCallback(
    async (index: number) => {
      const token = await getValidAccessToken();
      if (!token) return;
      const files = tracksToFiles(playlist);
      playTrack(files[index], files, token, [], playlist.id);
    },
    [playlist, playTrack, getValidAccessToken],
  );

  const handlePlayAll = useCallback(() => {
    if (playlist.tracks.length === 0) return;
    playFromPlaylist(0);
  }, [playlist.tracks.length, playFromPlaylist]);

  const handleRename = useCallback(() => {
    const name = editName.trim();
    if (name) {
      renamePlaylist(playlist.id, name);
    }
    setEditing(false);
  }, [editName, playlist.id, renamePlaylist]);

  const handleDelete = useCallback(() => {
    deletePlaylist(playlist.id);
    setActivePlaylist(null);
    setDeleteOpen(false);
  }, [playlist.id, deletePlaylist, setActivePlaylist]);

  const isPlayingThisPlaylist = playingPlaylistId === playlist.id;

  return (
    <div className="mx-auto flex h-full flex-col overflow-hidden px-4 pt-8">
      <div className="flex items-center gap-3">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to playlists"
            className="text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {editing ? (
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
              {playlist.name}
            </h1>
          )}
          {!editing && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground"
              onClick={() => {
                setEditName(playlist.name);
                setEditing(true);
                setTimeout(() => editRef.current?.focus(), 0);
              }}
              aria-label="Rename playlist"
            >
              <Pencil className="size-3" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            onClick={handlePlayAll}
            disabled={playlist.tracks.length === 0}
          >
            <Play className="size-3.5" />
            Play All
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete playlist"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <Separator className="my-3" />

      {playlist.tracks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/30">
            <ListMusic className="size-6" />
          </div>
          <span className="text-sm">No tracks yet</span>
          <span className="text-xs">
            Use the + button on file rows to add songs
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
              {playlist.tracks.map((track, index) => (
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
                  onPlay={() => playFromPlaylist(index)}
                  onRemove={() => removeTrack(playlist.id, track.fileId)}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogTitle>Delete playlist</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{playlist.name}&rdquo;? This
            cannot be undone.
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
