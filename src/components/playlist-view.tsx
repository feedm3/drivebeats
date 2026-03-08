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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "above" | "below";
  } | null>(null);

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

  const handlePlayTrack = useCallback(
    (index: number) => {
      playFromPlaylist(index);
    },
    [playFromPlaylist],
  );

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

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      if (dragFromIndex === null) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const position = e.clientY < midY ? "above" : "below";
      setDropTarget({ index, position });
    },
    [dragFromIndex],
  );

  const handleDrop = useCallback(() => {
    if (dragFromIndex === null || dropTarget === null) return;
    let toIndex =
      dropTarget.position === "above" ? dropTarget.index : dropTarget.index + 1;
    if (dragFromIndex < toIndex) toIndex--;
    if (dragFromIndex !== toIndex) {
      reorderTracks(playlist.id, dragFromIndex, toIndex);
    }
    setDragFromIndex(null);
    setDropTarget(null);
  }, [dragFromIndex, dropTarget, playlist.id, reorderTracks]);

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
            <div className="rounded-2xl border border-border/60 bg-background/80 shadow-xs">
              <Table aria-label="Playlist tracks">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11 w-8 px-1" />
                    <TableHead className="h-11 px-4">
                      <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                        Name
                      </span>
                    </TableHead>
                    <TableHead className="h-11 w-10 px-1" />
                  </TableRow>
                </TableHeader>
                <TableBody
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropTarget(null);
                    }
                  }}
                >
                  {playlist.tracks.map((track, index) => (
                    <PlaylistTrackItem
                      key={track.fileId}
                      track={track}
                      index={index}
                      isActive={
                        isPlayingThisPlaylist &&
                        currentTrack?.id === track.fileId
                      }
                      isPlaying={isPlaying}
                      onPlay={() => handlePlayTrack(index)}
                      onRemove={() => removeTrack(playlist.id, track.fileId)}
                      onDragStart={setDragFromIndex}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      dropPosition={
                        dropTarget?.index === index ? dropTarget.position : null
                      }
                    />
                  ))}
                </TableBody>
              </Table>
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
