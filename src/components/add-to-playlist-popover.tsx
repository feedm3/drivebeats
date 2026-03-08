"use client";

import { ListMusic, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DriveFile } from "@/types";
import { FOLDER_MIME } from "@/types";

interface AddToPlaylistPopoverProps {
  file: DriveFile;
}

export function AddToPlaylistPopover({ file }: AddToPlaylistPopoverProps) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const addTracks = usePlaylistStore((s) => s.addTracks);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  const isFolder = file.mimeType === FOLDER_MIME;

  function getTracksForFile() {
    if (!isFolder) {
      return [{ fileId: file.id, fileName: file.name }];
    }
    const cached = getCachedFiles(file.id);
    if (!cached) {
      toast.info("Folder not loaded yet — open it first, then try again");
      return null;
    }
    const mp3s = cached.files
      .filter((f) => f.mimeType !== FOLDER_MIME)
      .map((f) => ({ fileId: f.id, fileName: f.name }));
    if (mp3s.length === 0) {
      toast.info("No audio files in this folder");
      return null;
    }
    return mp3s;
  }

  function handleAdd(playlistId: string, playlistName: string) {
    const tracks = getTracksForFile();
    if (!tracks) return;
    addTracks(playlistId, tracks);
    toast.success(
      `Added ${tracks.length} track${tracks.length > 1 ? "s" : ""} to ${playlistName}`,
    );
    setOpen(false);
    setCreating(false);
    setNewName("");
  }

  function handleCreateAndAdd() {
    const name = newName.trim();
    if (!name) return;
    const tracks = getTracksForFile();
    if (!tracks) return;
    const id = createPlaylist(name);
    addTracks(id, tracks);
    toast.success(
      `Created "${name}" with ${tracks.length} track${tracks.length > 1 ? "s" : ""}`,
    );
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
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Add ${file.name} to playlist`}
          />
        }
      >
        <Plus className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-52">
        <div className="max-h-60 overflow-y-auto">
          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                handleAdd(p.id, p.name);
              }}
            >
              <ListMusic className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {p.tracks.length}
              </span>
            </button>
          ))}
        </div>
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
                if (e.key === "Enter") handleCreateAndAdd();
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
            className="flex w-full items-center gap-2 border-t px-2 py-1.5 text-sm hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              setCreating(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <Plus className="size-3.5 shrink-0 text-muted-foreground" />
            New playlist
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
