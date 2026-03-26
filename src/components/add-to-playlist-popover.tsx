"use client";

import { Check, ListMusic, Plus, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createPlaylistTrack } from "@/lib/audio";
import {
  hasReachedPlaylistCountLimit,
  isPlaylistFull,
  MAX_PLAYLISTS_PER_USER,
  MAX_TRACKS_PER_PLAYLIST,
  PLAYLIST_COUNT_LIMIT_ERROR,
} from "@/lib/playlist-limits";
import {
  notifyPlaylistCreatedWithTracks,
  notifyPlaylistTrackAddResult,
  shouldClosePlaylistPicker,
} from "@/lib/playlist-notifications";
import { cn } from "@/lib/utils";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

interface AddToPlaylistPopoverProps {
  file: DriveFile;
  className?: string;
}

export function AddToPlaylistPopover({
  file,
  className,
}: AddToPlaylistPopoverProps) {
  const addTracks = usePlaylistStore((s) => s.addTracks);
  const removeTrack = usePlaylistStore((s) => s.removeTrack);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [playlistsSnapshot, setPlaylistsSnapshot] = useState(
    () => usePlaylistStore.getState().playlists,
  );

  const isFolder = file.mimeType === FOLDER_MIME;
  const playlistCountLimitReached = hasReachedPlaylistCountLimit(
    playlistsSnapshot.length,
  );
  const hasFullPlaylist = playlistsSnapshot.some((playlist) =>
    isPlaylistFull(playlist.tracks.length),
  );
  const containedPlaylistIds = new Set(
    isFolder
      ? []
      : playlistsSnapshot
          .filter((p) => p.tracks.some((t) => t.fileId === file.id))
          .map((p) => p.id),
  );

  function getTracksForFile() {
    if (!isFolder) {
      return [createPlaylistTrack(file)];
    }
    const cached = getCachedFiles(file.id);
    if (!cached) {
      toast.info("Folder not loaded yet — open it first, then try again");
      return null;
    }
    const tracks = cached.files
      .filter((f) => f.mimeType !== FOLDER_MIME)
      .map(createPlaylistTrack);
    if (tracks.length === 0) {
      toast.info("No audio files in this folder");
      return null;
    }
    return tracks;
  }

  async function handleAdd(playlistId: string, playlistName: string) {
    const tracks = getTracksForFile();
    if (!tracks) return;
    const result = await addTracks(playlistId, tracks);
    setPlaylistsSnapshot(usePlaylistStore.getState().playlists);
    notifyPlaylistTrackAddResult(playlistName, result);

    if (shouldClosePlaylistPicker(result)) {
      setOpen(false);
      setCreating(false);
      setNewName("");
    }
  }

  async function handleRemove(playlistId: string, playlistName: string) {
    await removeTrack(playlistId, file.id);
    setPlaylistsSnapshot(usePlaylistStore.getState().playlists);
    toast.success(`Removed from ${playlistName}`);
  }

  async function handleCreateAndAdd() {
    const name = newName.trim();
    if (!name) return;
    const tracks = getTracksForFile();
    if (!tracks) return;
    const id = await createPlaylist(name);
    if (!id) {
      return;
    }

    const result = await addTracks(id, tracks);
    notifyPlaylistCreatedWithTracks(name, result);

    setOpen(false);
    setCreating(false);
    setNewName("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setCreating(false);
          setNewName("");
          return;
        }

        setPlaylistsSnapshot(usePlaylistStore.getState().playlists);
      }}
    >
      <IconTooltip label="Add to playlist" side="top" align="end">
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color,background-color] hover:bg-accent hover:text-foreground",
                className,
              )}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Add ${file.name} to playlist`}
            />
          }
        >
          <Plus className="size-3.5" />
        </PopoverTrigger>
      </IconTooltip>
      {open ? (
        <PopoverContent side="left" align="start" className="w-52">
          <div className="max-h-60 overflow-y-auto">
            {playlistsSnapshot.map((p) => {
              const isInPlaylist = !isFolder && containedPlaylistIds.has(p.id);
              const isFull = isPlaylistFull(p.tracks.length);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  aria-pressed={isInPlaylist}
                  aria-label={
                    isInPlaylist
                      ? `Remove ${file.name} from ${p.name}`
                      : `Add ${file.name} to ${p.name}`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isInPlaylist) {
                      void handleRemove(p.id, p.name);
                    } else {
                      void handleAdd(p.id, p.name);
                    }
                  }}
                  disabled={isFull && !isInPlaylist}
                >
                  {isInPlaylist ? (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <ListMusic className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{p.name}</span>
                  {isFull && !isInPlaylist && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      Full
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto shrink-0 text-xs tabular-nums",
                      isFull && !isInPlaylist
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground",
                    )}
                  >
                    {p.tracks.length}
                  </span>
                </button>
              );
            })}
          </div>
          {hasFullPlaylist && (
            <div className="border-t px-2 py-2 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Full playlists cannot take more than {MAX_TRACKS_PER_PLAYLIST}{" "}
                  songs.
                </span>
              </div>
            </div>
          )}
          {creating ? (
            <div className="border-t px-2 py-1.5">
              <input
                ref={inputRef}
                type="text"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                placeholder="Playlist name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") void handleCreateAndAdd();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t px-2 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              onClick={(e) => {
                e.stopPropagation();
                if (playlistCountLimitReached) {
                  toast.warning(PLAYLIST_COUNT_LIMIT_ERROR);
                  return;
                }
                setCreating(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              disabled={playlistCountLimitReached}
            >
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              {playlistCountLimitReached
                ? `Playlist limit reached (${MAX_PLAYLISTS_PER_USER})`
                : "New playlist"}
            </button>
          )}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
