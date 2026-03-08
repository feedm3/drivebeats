"use client";

import {
  ChevronRight,
  ListMusic,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { PlaylistTrack } from "@/types";
import { FOLDER_MIME } from "@/types";

interface PlaylistSectionProps {
  onSelectPlaylist: (id: string) => void;
  activePlaylistId: string | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function PlaylistSection({
  onSelectPlaylist,
  activePlaylistId,
  collapsed,
  onToggleCollapsed,
}: PlaylistSectionProps) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const addTracks = usePlaylistStore((s) => s.addTracks);
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);
  const playingPlaylistId = usePlayerStore((s) => s.playingPlaylistId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deletePlaylistName =
    playlists.find((p) => p.id === deleteConfirmId)?.name ?? "";

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    const name = createName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    createPlaylist(name);
    setCreateName("");
    setCreating(false);
  }, [createName, createPlaylist]);

  const handleRename = useCallback(() => {
    const name = renameValue.trim();
    if (name && renamingId) {
      renamePlaylist(renamingId, name);
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renameValue, renamingId, renamePlaylist]);

  const handleDrop = useCallback(
    (playlistId: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverId(null);
      try {
        const raw = e.dataTransfer.getData("application/drivebeats");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.type === "tracks") {
          const tracks: PlaylistTrack[] = data.tracks;
          addTracks(playlistId, tracks);
          toast.success(
            `Added ${tracks.length} track${tracks.length > 1 ? "s" : ""}`,
          );
        } else if (data.type === "folder") {
          const cached = getCachedFiles(data.folderId);
          if (cached) {
            const mp3s = cached.files
              .filter((f) => f.mimeType !== FOLDER_MIME)
              .map((f) => ({ fileId: f.id, fileName: f.name }));
            if (mp3s.length > 0) {
              addTracks(playlistId, mp3s);
              toast.success(
                `Added ${mp3s.length} track${mp3s.length > 1 ? "s" : ""}`,
              );
            } else {
              toast.info("No audio files found in folder");
            }
          } else {
            toast.info("Folder not loaded yet — open it first, then try again");
          }
        }
      } catch {
        // ignore malformed data
      }
    },
    [addTracks, getCachedFiles],
  );

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-6 pb-2">
        {onToggleCollapsed ? (
          <button
            type="button"
            className="group/hdr flex items-center gap-1 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground transition-colors hover:text-foreground"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
          >
            Playlists
            <ChevronRight
              className={cn(
                "size-3 opacity-0 transition-all group-hover/hdr:opacity-100",
                !collapsed && "rotate-90",
              )}
            />
          </button>
        ) : (
          <h2 className="text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground">
            Playlists
          </h2>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => {
            setCreating(true);
            setTimeout(() => createInputRef.current?.focus(), 0);
          }}
          aria-label="Create playlist"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {!collapsed && (
        <div className="px-2 pb-4">
          {creating && (
            <div className="px-2 py-1">
              <input
                ref={createInputRef}
                type="text"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                placeholder="Playlist name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setCreateName("");
                  }
                }}
                onBlur={handleCreate}
              />
            </div>
          )}

          {playlists.length === 0 && !creating && (
            <div className="px-2 py-4 text-sm text-muted-foreground">
              No playlists yet
            </div>
          )}

          {playlists.map((playlist) => {
            const isActive = activePlaylistId === playlist.id;
            const isPlayingThis = playingPlaylistId === playlist.id;
            const isDragOver = dragOverId === playlist.id;

            if (renamingId === playlist.id) {
              return (
                <div key={playlist.id} className="px-2 py-1">
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") {
                        setRenamingId(null);
                        setRenameValue("");
                      }
                    }}
                    onBlur={handleRename}
                  />
                </div>
              );
            }

            return (
              <div
                key={playlist.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors cursor-pointer",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                  isDragOver && "ring-2 ring-primary/60 bg-primary/10",
                )}
                onClick={() => onSelectPlaylist(playlist.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPlaylist(playlist.id);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDragEnter={() => setDragOverId(playlist.id)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverId(null);
                  }
                }}
                onDrop={(e) => handleDrop(playlist.id, e)}
              >
                <span
                  className={cn(
                    "shrink-0",
                    isPlayingThis ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {isPlayingThis ? (
                    <NowPlayingBars className="size-4" paused={!isPlaying} />
                  ) : (
                    <ListMusic className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Options for ${playlist.name}`}
                      />
                    }
                  >
                    <MoreHorizontal className="size-3.5" />
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-40">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(playlist.id);
                        setRenameValue(playlist.name);
                        setTimeout(() => renameInputRef.current?.focus(), 0);
                      }}
                    >
                      <Pencil className="size-3.5" />
                      Rename
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(playlist.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </button>
                  </PopoverContent>
                </Popover>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {playlist.tracks.length}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete playlist</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{deletePlaylistName}&rdquo;?
            This cannot be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleteConfirmId) {
                  deletePlaylist(deleteConfirmId);
                  setDeleteConfirmId(null);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
