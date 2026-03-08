"use client";

import { ListMusic } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { NowPlayingBars } from "@/components/now-playing-bars";
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
}

export interface PlaylistSectionHandle {
  startCreating: () => void;
}

export const PlaylistSection = forwardRef<PlaylistSectionHandle, PlaylistSectionProps>(function PlaylistSection({
  onSelectPlaylist,
  activePlaylistId,
  collapsed,
}, ref) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const addTracks = usePlaylistStore((s) => s.addTracks);
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);
  const playingPlaylistId = usePlayerStore((s) => s.playingPlaylistId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    startCreating: () => {
      setCreating(true);
      setTimeout(() => createInputRef.current?.focus(), 0);
    },
  }));

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
      {!collapsed && (
        <div className="pb-4">
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
                <span className="shrink-0 min-w-6 text-center text-xs text-muted-foreground tabular-nums">
                  {playlist.tracks.length}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
