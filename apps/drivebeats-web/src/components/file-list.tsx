"use client";

import { Folder, Music4, Search } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FavoriteToggleButton } from "@/components/favorite-toggle-button";
import {
  FILE_TABLE_SHELL_CLASS,
  FileListSkeleton,
} from "@/components/file-list-skeleton";
import { HighlightedName } from "@/components/highlighted-name";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { TrackRowMenu } from "@/components/track-row-menu";
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
import { useCachedTrackSearch } from "@/hooks/use-cached-track-search";
import { useCachedTrackTags } from "@/hooks/use-cached-track-tags";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { createPlaylistTrack } from "@/lib/audio";
import type { Id3Metadata } from "@/lib/id3-metadata";
import {
  observeVisibleMetadataTrack,
  setCurrentMetadataFolder,
} from "@/lib/metadata-index-coordinator";
import { resolveTrackMetadata } from "@/lib/track-metadata";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME } from "@/types";

interface FileListProps {
  metadataById?: ReadonlyMap<string, Id3Metadata | undefined>;
  contextById?: ReadonlyMap<string, string>;
  files: DriveFile[];
  folderStackById?: ReadonlyMap<string, FolderEntry[]>;
  loading: boolean;
  folderStack: FolderEntry[];
  searchQuery: string;
  searchScope?: "library" | "folder";
  sortPathById?: ReadonlyMap<string, string>;
  onClearSearch: () => void;
  onFolderClick: (id: string, name: string) => void;
}

type NameSortDirection = "asc" | "desc";
const INITIAL_VISIBLE_FILE_COUNT = 200;
const VISIBLE_FILE_BATCH_SIZE = 200;
const rowActionCellClassName = "w-11 px-0 py-0";

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
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}

function sortFilesByName(
  files: DriveFile[],
  direction: NameSortDirection,
  contextById?: ReadonlyMap<string, string>,
  sortPathById?: ReadonlyMap<string, string>,
) {
  return [...files].sort((a, b) => {
    const folderOrder = Number(isFolder(b)) - Number(isFolder(a));
    if (folderOrder !== 0) return folderOrder;

    const comparedName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });

    if (comparedName !== 0) {
      return direction === "asc" ? comparedName : -comparedName;
    }

    const comparedContext = (
      sortPathById?.get(a.id) ??
      contextById?.get(a.id) ??
      ""
    ).localeCompare(
      sortPathById?.get(b.id) ?? contextById?.get(b.id) ?? "",
      undefined,
      { sensitivity: "base", numeric: true },
    );
    if (comparedContext !== 0) {
      return direction === "asc" ? comparedContext : -comparedContext;
    }
    const comparedId = a.id.localeCompare(b.id);
    return direction === "asc" ? comparedId : -comparedId;
  });
}

function FileMetadata({
  file,
  context,
  searchQuery,
  tags,
}: {
  file: DriveFile;
  context?: string;
  searchQuery: string;
  tags?: Id3Metadata;
}) {
  const metadata = resolveTrackMetadata(file.name, file.parentFolderName, tags);
  if (isFolder(file))
    return (
      <>
        <HighlightedName name={file.name} searchQuery={searchQuery} />
        {context ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {context}
          </span>
        ) : null}
      </>
    );
  const subtitle = [metadata.subtitle, tags?.album].filter(Boolean).join(" · ");
  return (
    <>
      <HighlightedName name={metadata.title} searchQuery={searchQuery} />
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
        <span className="sm:hidden">{metadata.subtitle}</span>
        <span className="hidden sm:inline" title={subtitle}>
          {subtitle}
        </span>
      </span>
    </>
  );
}

interface FileListRowProps {
  cachedTags?: Id3Metadata;
  file: DriveFile;
  context?: string;
  folderStack: FolderEntry[];
  playableTracks: DriveFile[];
  playlistFolderStacks?: FolderEntry[][];
  searchQuery: string;
  isActive: boolean;
  isCurrentlyPlaying: boolean;
  isPlayingAncestor: boolean;
  isPlaybackPaused: boolean;
  onFolderClick: (id: string, name: string) => void;
  playTrack: ReturnType<typeof usePlayerStore.getState>["playTrack"];
  togglePlay: () => void;
}

const FileListRow = memo(function FileListRow({
  cachedTags,
  file,
  context,
  folderStack,
  playableTracks,
  playlistFolderStacks,
  searchQuery,
  isActive,
  isCurrentlyPlaying,
  isPlayingAncestor,
  isPlaybackPaused,
  onFolderClick,
  playTrack,
  togglePlay,
}: FileListRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const liveTags = useCachedTrackTags(file);
  const tags = cachedTags ?? liveTags;
  const metadata = resolveTrackMetadata(file.name, file.parentFolderName, tags);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (!rowRef.current || isFolder(file)) return;
    return observeVisibleMetadataTrack(rowRef.current, file);
  }, [file]);
  const folder = isFolder(file);
  const onActivate = () =>
    folder
      ? onFolderClick(file.id, file.name)
      : isCurrentlyPlaying
        ? togglePlay()
        : void playTrack(
            file,
            playableTracks,
            folderStack,
            undefined,
            playlistFolderStacks,
          );

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
    <>
      <TableRow
        ref={rowRef}
        title={file.name}
        data-active={isActive || undefined}
        tabIndex={0}
        role="button"
        aria-label={folder ? `Open folder ${file.name}` : `Play ${file.name}`}
        // `active:bg-muted` is the touch press state: with the iOS tap highlight
        // removed, `hover:` alone leaves a tap on the row looking dead.
        className="group cursor-pointer active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onActivate}
        onKeyDown={(event) => onRowKeyDown(event, onActivate)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("application/drivebeats", dragData);
        }}
      >
        <TableCell className="max-w-0 p-0 sm:px-3 sm:py-0">
          <div
            className={cn(
              "flex min-h-16 w-full items-center gap-3 px-2 py-2 text-left",
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
              <FileMetadata
                file={file}
                context={context}
                tags={tags}
                searchQuery={searchQuery}
              />
            </span>
          </div>
        </TableCell>
        <TableCell
          className={cn(rowActionCellClassName, "hidden sm:table-cell")}
        >
          {!folder ? (
            <FavoriteToggleButton
              fileId={file.id}
              fileName={file.name}
              mimeType={file.mimeType}
              parents={file.parents}
              size="icon-sm"
              className="size-11"
            />
          ) : null}
        </TableCell>
        <TableCell className="w-14 py-0 pl-0 pr-3">
          <TrackRowMenu
            file={file}
            folderStack={
              playlistFolderStacks?.[
                playableTracks.findIndex((track) => track.id === file.id)
              ] ?? folderStack
            }
            onDetails={() => setDetailsOpen((value) => !value)}
            detailsOpen={detailsOpen}
          />
        </TableCell>
      </TableRow>
      {detailsOpen ? (
        <TableRow
          id={`track-details-${file.id}`}
          className="bg-muted/20 hover:bg-muted/20"
        >
          <TableCell colSpan={3} className="px-4 py-3 whitespace-normal">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Title</dt>
              <dd className="break-words">{metadata.title}</dd>
              <dt className="text-muted-foreground">Album</dt>
              <dd className="break-words">{tags?.album || "No album tag"}</dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatSize(file.size)}</dd>
              <dt className="text-muted-foreground">File</dt>
              <dd className="break-words">{file.name}</dd>
            </dl>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
});

export function FileList({
  metadataById,
  contextById,
  files,
  folderStackById,
  loading,
  folderStack,
  searchQuery,
  searchScope = "folder",
  sortPathById,
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
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_FILE_COUNT);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const activeTrackId = pendingTrackId ?? currentTrackId;
  const playingFolderStack = usePlayerStore(
    (state) => state.playingFolderStack,
  );
  const playingFolderIds = useMemo(
    () => new Set(playingFolderStack.map((f) => f.id)),
    [playingFolderStack],
  );
  useEffect(
    () => setCurrentMetadataFolder(folderStack, files),
    [folderStack, files],
  );
  const sortedFiles = useMemo(
    () => sortFilesByName(files, nameSortDirection, contextById, sortPathById),
    [contextById, files, nameSortDirection, sortPathById],
  );
  const folderSearch = useCachedTrackSearch(
    sortedFiles,
    searchQuery,
    searchScope !== "library" && searchQuery.trim().length > 0,
  );
  const filteredFiles = folderSearch.tracks;
  const displayTags = metadataById ?? folderSearch.metadataById;
  const playableTracks = useMemo(
    () => filteredFiles.filter((file) => !isFolder(file)),
    [filteredFiles],
  );
  const playlistFolderStacks = useMemo(
    () =>
      folderStackById
        ? playableTracks.map(
            (track) => folderStackById.get(track.id) ?? folderStack,
          )
        : undefined,
    [folderStack, folderStackById, playableTracks],
  );
  const resetVisibleCountKey = useMemo(
    () =>
      [
        files.length,
        files[0]?.id ?? "",
        files[files.length - 1]?.id ?? "",
        nameSortDirection,
        searchQuery,
      ].join("|"),
    [files, nameSortDirection, searchQuery],
  );
  const visibleFiles = useMemo(
    () => filteredFiles.slice(0, visibleCount),
    [filteredFiles, visibleCount],
  );
  const hasActiveSearch = searchQuery.trim().length > 0;

  useEffect(() => {
    if (resetVisibleCountKey.length === 0) {
      return;
    }

    setVisibleCount(INITIAL_VISIBLE_FILE_COUNT);
  }, [resetVisibleCountKey]);

  useEffect(() => {
    if (visibleCount >= filteredFiles.length) {
      return;
    }

    const node = loadMoreRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setVisibleCount((current) =>
          Math.min(current + VISIBLE_FILE_BATCH_SIZE, filteredFiles.length),
        );
      },
      {
        rootMargin: "320px 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [filteredFiles.length, visibleCount]);

  if (loading || folderSearch.pending) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn(playerBarPadding)}>
          <FileListSkeleton />
        </div>
      </ScrollArea>
    );
  }

  if (files.length === 0 && !hasActiveSearch) {
    return (
      <div className="flex min-h-0 flex-1 items-start">
        <div className={cn("w-full", playerBarPadding)}>
          <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Music4 className="size-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold tracking-tight">Nothing here yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add audio files (MP3, FLAC, WAV, AAC, OGG) to this folder in
                Google Drive to see them here.
              </p>
            </div>
          </div>
        </div>
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
                No matches in{" "}
                {searchScope === "library" ? "your Library" : "this folder"}
              </h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {hasActiveSearch
                  ? `Nothing in this view matches “${searchQuery}”. Try a shorter term or clear the filter.`
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
          <Table
            aria-label={
              searchScope === "library"
                ? "Library Search results"
                : "Files and folders"
            }
          >
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-11 px-2 sm:px-4">
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
                <TableHead className="hidden h-11 w-11 px-0 sm:table-cell" />
                <TableHead className="h-11 w-14 pl-0 pr-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFiles.map((file) => {
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
                    cachedTags={displayTags?.get(file.id)}
                    context={contextById?.get(file.id)}
                    folderStack={folderStack}
                    playableTracks={playableTracks}
                    playlistFolderStacks={playlistFolderStacks}
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
        {visibleFiles.length < filteredFiles.length ? (
          <div
            ref={loadMoreRef}
            className="flex h-14 items-center justify-center px-4 text-xs text-muted-foreground"
          >
            Showing {visibleFiles.length} of {filteredFiles.length} items
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
