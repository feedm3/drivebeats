"use client";

import { Download, Heart, History, ListMusic, Plus } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";
import { createPlaylistTrack } from "@/lib/audio";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import {
  getFavoriteTracks,
  getRecentlyPlayedTracks,
  useLibraryStore,
} from "@/stores/library-store";
import { useOfflineStore } from "@/stores/offline-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { PlaylistTrack } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  FOLDER_MIME,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

interface PlaylistSectionProps {
  onSelectPlaylist: (id: string) => void;
  activePlaylistId: string | null;
  collapsed?: boolean;
}

export interface PlaylistSectionHandle {
  startCreating: () => void;
}

export const PlaylistSection = forwardRef<
  PlaylistSectionHandle,
  PlaylistSectionProps
>(function PlaylistSection(
  { onSelectPlaylist, activePlaylistId, collapsed },
  ref,
) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const favoriteTracks = useMemo(
    () => getFavoriteTracks(libraryTracks),
    [libraryTracks],
  );
  const recentlyPlayedTracks = useMemo(
    () => getRecentlyPlayedTracks(libraryTracks),
    [libraryTracks],
  );
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const addTracks = usePlaylistStore((s) => s.addTracks);
  const getCachedFiles = useFolderCacheStore((s) => s.getFiles);
  const playingPlaylistId = usePlayerStore((s) => s.playingPlaylistId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const offlineCollections = useOfflineStore((s) => s.collections);

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleStartCreating = useCallback(() => {
    setCreating(true);
    setTimeout(() => createInputRef.current?.focus(), 0);
  }, []);

  useImperativeHandle(ref, () => ({
    startCreating: handleStartCreating,
  }));

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    await createPlaylist(name);
    setCreateName("");
    setCreating(false);
  }, [createName, createPlaylist]);

  const handleDrop = useCallback(
    async (playlistId: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverId(null);
      try {
        const raw = e.dataTransfer.getData("application/drivebeats");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.type === "tracks") {
          const tracks: PlaylistTrack[] = data.tracks;
          await addTracks(playlistId, tracks);
          toast.success(
            `Added ${tracks.length} track${tracks.length > 1 ? "s" : ""}`,
          );
        } else if (data.type === "folder") {
          const cached = getCachedFiles(data.folderId);
          if (cached) {
            const tracks = cached.files
              .filter((f) => f.mimeType !== FOLDER_MIME)
              .map(createPlaylistTrack);
            if (tracks.length > 0) {
              await addTracks(playlistId, tracks);
              toast.success(
                `Added ${tracks.length} track${tracks.length > 1 ? "s" : ""}`,
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
          <div className="px-2 pb-2 text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-foreground">
            Library
          </div>
          <div className="space-y-1">
            {[
              {
                id: FAVORITES_COLLECTION_ID,
                label: "Favorites",
                count: favoriteTracks.length,
                icon: <Heart className="size-4 fill-current" />,
              },
              {
                id: RECENTLY_PLAYED_COLLECTION_ID,
                label: "Recently played",
                count: recentlyPlayedTracks.length,
                icon: <History className="size-4" />,
              },
            ].map((collection) => {
              const isActive = activePlaylistId === collection.id;
              const isPlayingThis = playingPlaylistId === collection.id;

              return (
                <button
                  key={collection.id}
                  type="button"
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => onSelectPlaylist(collection.id)}
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
                      collection.icon
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {collection.label}
                  </span>
                  {offlineCollections[collection.id]?.enabled && (
                    <Download className="size-3 shrink-0 text-primary/60" />
                  )}
                  <span className="shrink-0 min-w-6 text-center text-xs text-muted-foreground tabular-nums">
                    {collection.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-2 px-2 pb-2">
            <div className="min-w-0 flex-1 text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-foreground">
              Your playlists
            </div>
            <div className="flex min-w-6 shrink-0 justify-center">
              <IconTooltip label="Create playlist">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  onClick={handleStartCreating}
                  aria-label="Create playlist"
                >
                  <Plus className="size-3.5" />
                </Button>
              </IconTooltip>
            </div>
          </div>

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
                  if (e.key === "Enter") void handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setCreateName("");
                  }
                }}
                onBlur={() => void handleCreate()}
              />
            </div>
          )}

          {playlists.length === 0 && !creating && (
            <div className="px-2 py-4 text-sm text-muted-foreground">
              No custom playlists yet
            </div>
          )}

          <div className="space-y-1">
            {playlists.map((playlist) => {
              const isActive = activePlaylistId === playlist.id;
              const isPlayingThis = playingPlaylistId === playlist.id;
              const isDragOver = dragOverId === playlist.id;

              const isOfflineEnabled =
                !!offlineCollections[playlist.id]?.enabled;

              return (
                <button
                  key={playlist.id}
                  type="button"
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                    isDragOver && "ring-2 ring-primary/60 bg-primary/10",
                  )}
                  onClick={() => onSelectPlaylist(playlist.id)}
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
                  onDrop={(e) => void handleDrop(playlist.id, e)}
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
                  <span className="min-w-0 flex-1 truncate">
                    {playlist.name}
                  </span>
                  {isOfflineEnabled && (
                    <Download className="size-3 shrink-0 text-primary/60" />
                  )}
                  <span className="shrink-0 min-w-6 text-center text-xs text-muted-foreground tabular-nums">
                    {playlist.tracks.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
