"use client";

import { Folder, Music4, Search } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { AddToPlaylistPopover } from "@/components/add-to-playlist-popover";
import { FavoriteToggleButton } from "@/components/favorite-toggle-button";
import {
  FILE_TABLE_SHELL_CLASS,
  FileListSkeleton,
} from "@/components/file-list-skeleton";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { createPlaylistTrack } from "@/lib/audio";
import {
  filterFilesBySearch,
  getHighlightedTextParts,
} from "@/lib/file-search";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME } from "@/types";

interface FileListProps {
  files: DriveFile[];
  loading: boolean;
  folderStack: FolderEntry[];
  searchQuery: string;
  onClearSearch: () => void;
  onFolderClick: (id: string, name: string) => void;
}

type NameSortDirection = "asc" | "desc";
const rowActionClassName =
  "opacity-100 transition-none md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100";

function isFolder(file: DriveFile) {
  return file.mimeType === FOLDER_MIME;
}

function formatSize(bytes: string | undefined) {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function onRowKeyDown(
  event: React.KeyboardEvent<HTMLTableRowElement>,
  onActivate: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function sortFilesByName(files: DriveFile[], direction: NameSortDirection) {
  return [...files].sort((a, b) => {
    const folderOrder = Number(isFolder(b)) - Number(isFolder(a));
    if (folderOrder !== 0) return folderOrder;

    const comparedName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });

    return direction === "asc" ? comparedName : -comparedName;
  });
}

function HighlightedName({
  name,
  searchQuery,
}: {
  name: string;
  searchQuery: string;
}) {
  const parts = getHighlightedTextParts(name, searchQuery);

  return (
    <span className="block truncate font-medium">
      {parts.map((part) =>
        part.isMatch ? (
          <mark
            key={`${part.start}-${part.value}`}
            className="rounded-sm bg-primary/12 px-0.5 text-foreground"
          >
            {part.value}
          </mark>
        ) : (
          <span key={`${part.start}-${part.value}`}>{part.value}</span>
        ),
      )}
    </span>
  );
}

interface FileListRowProps {
  file: DriveFile;
  folderStack: FolderEntry[];
  playableTracks: DriveFile[];
  searchQuery: string;
  isActive: boolean;
  isCurrentlyPlaying: boolean;
  isPlayingAncestor: boolean;
  isPlaybackPaused: boolean;
  onFolderClick: (id: string, name: string) => void;
  playTrack: (
    track: DriveFile,
    playlist: DriveFile[],
    folderStack: FolderEntry[],
    playlistId?: string,
  ) => Promise<void>;
  togglePlay: () => void;
}

const FileListRow = memo(function FileListRow({
  file,
  folderStack,
  playableTracks,
  searchQuery,
  isActive,
  isCurrentlyPlaying,
  isPlayingAncestor,
  isPlaybackPaused,
  onFolderClick,
  playTrack,
  togglePlay,
}: FileListRowProps) {
  const folder = isFolder(file);
  const onActivate = () =>
    folder
      ? onFolderClick(file.id, file.name)
      : isCurrentlyPlaying
        ? togglePlay()
        : void playTrack(file, playableTracks, folderStack);

  const dragData = folder
    ? JSON.stringify({
        type: "folder",
        folderId: file.id,
        folderName: file.name,
      })
    : JSON.stringify({
        type: "tracks",
        tracks: [createPlaylistTrack(file)],
      });

  return (
    <TableRow
      data-active={isActive || undefined}
      tabIndex={0}
      role="button"
      aria-label={folder ? `Open folder ${file.name}` : `Play ${file.name}`}
      className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onActivate}
      onKeyDown={(event) => onRowKeyDown(event, onActivate)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/drivebeats", dragData);
      }}
    >
      <TableCell className="max-w-0">
        <div
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
            isActive && "text-primary",
          )}
        >
          <span
            className={cn(
              "shrink-0",
              isPlayingAncestor || isActive
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            {isPlayingAncestor || isCurrentlyPlaying ? (
              <NowPlayingBars className="size-4" paused={isPlaybackPaused} />
            ) : folder ? (
              <Folder className="size-4" />
            ) : (
              <Music4 className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <HighlightedName name={file.name} searchQuery={searchQuery} />
          </span>
        </div>
      </TableCell>
      <TableCell className="w-9 px-0.5">
        {!folder ? (
          <FavoriteToggleButton
            fileId={file.id}
            fileName={file.name}
            mimeType={file.mimeType}
            parents={file.parents}
            size="icon-sm"
            className={rowActionClassName}
          />
        ) : null}
      </TableCell>
      <TableCell className="w-9 px-0.5">
        <AddToPlaylistPopover file={file} className={rowActionClassName} />
      </TableCell>
      <TableCell className="text-muted-foreground text-right tabular-nums">
        {folder ? "—" : formatSize(file.size)}
      </TableCell>
    </TableRow>
  );
});

export function FileList({
  files,
  loading,
  folderStack,
  searchQuery,
  onClearSearch,
  onFolderClick,
}: FileListProps) {
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const currentTrackId = usePlayerStore((state) => state.currentTrack?.id);
  const pendingTrackId = usePlayerStore((state) => state.pendingTrackId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playerBarPadding = usePlayerBarPadding();
  const [nameSortDirection, setNameSortDirection] =
    useState<NameSortDirection>("asc");
  const activeTrackId = pendingTrackId ?? currentTrackId;
  const playingFolderStack = usePlayerStore(
    (state) => state.playingFolderStack,
  );
  const playingFolderIds = useMemo(
    () => new Set(playingFolderStack.map((f) => f.id)),
    [playingFolderStack],
  );
  const sortedFiles = useMemo(
    () => sortFilesByName(files, nameSortDirection),
    [files, nameSortDirection],
  );
  const filteredFiles = useMemo(
    () => filterFilesBySearch(sortedFiles, searchQuery),
    [sortedFiles, searchQuery],
  );
  const playableTracks = useMemo(
    () => filteredFiles.filter((file) => !isFolder(file)),
    [filteredFiles],
  );
  const hasActiveSearch = searchQuery.trim().length > 0;

  if (loading) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn(playerBarPadding)}>
          <FileListSkeleton />
        </div>
      </ScrollArea>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <span>Nothing here yet</span>
        <span className="text-sm">
          Add audio files (MP3, FLAC, WAV, AAC, OGG) to this folder in Google
          Drive to see them here.
        </span>
      </div>
    );
  }

  if (filteredFiles.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-start">
        <div className={cn("w-full", playerBarPadding)}>
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Search className="size-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold tracking-tight">
                No matches in this folder
              </h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {hasActiveSearch
                  ? `Nothing in this view matches "${searchQuery}". Try a shorter term or clear the filter.`
                  : "There are no visible items in this view."}
              </p>
            </div>
            {hasActiveSearch ? (
              <Button variant="outline" size="sm" onClick={onClearSearch}>
                Clear search
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn(playerBarPadding)}>
        <div className={FILE_TABLE_SHELL_CLASS}>
          <Table aria-label="Files and folders">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-11 px-4">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] uppercase transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={`Sort by name ${nameSortDirection === "asc" ? "descending" : "ascending"}`}
                    onClick={() =>
                      setNameSortDirection((direction) =>
                        direction === "asc" ? "desc" : "asc",
                      )
                    }
                  >
                    <span>Name</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "text-[10px] transition-transform",
                        nameSortDirection === "desc" && "rotate-180",
                      )}
                    >
                      ▲
                    </span>
                  </button>
                </TableHead>
                <TableHead className="h-11 w-9 px-0.5" />
                <TableHead className="h-11 w-9 px-0.5" />
                <TableHead className="h-11 w-[96px] px-4 text-right">
                  <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                    Size
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFiles.map((file) => {
                const isActive = activeTrackId === file.id;
                const isCurrentlyPlaying = currentTrackId === file.id;
                const isPlayingAncestor = Boolean(
                  isFolder(file) &&
                    activeTrackId &&
                    playingFolderIds.has(file.id),
                );
                const isPlaybackPaused =
                  isPlayingAncestor || isCurrentlyPlaying ? !isPlaying : false;

                return (
                  <FileListRow
                    key={file.id}
                    file={file}
                    folderStack={folderStack}
                    playableTracks={playableTracks}
                    searchQuery={searchQuery}
                    isActive={isActive}
                    isCurrentlyPlaying={isCurrentlyPlaying}
                    isPlayingAncestor={isPlayingAncestor}
                    isPlaybackPaused={isPlaybackPaused}
                    onFolderClick={onFolderClick}
                    playTrack={playTrack}
                    togglePlay={togglePlay}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </ScrollArea>
  );
}
