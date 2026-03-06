"use client";

import { useMemo, useState } from "react";
import { Folder, Music4 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";

interface FileListProps {
  files: DriveFile[];
  loading: boolean;
  accessToken: string;
  folderStack: FolderEntry[];
  onFolderClick: (id: string, name: string) => void;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const LOADING_ROWS = [
  { id: "loading-row-1", nameWidth: "w-40", sizeWidth: "w-12" },
  { id: "loading-row-2", nameWidth: "w-56", sizeWidth: "w-16" },
  { id: "loading-row-3", nameWidth: "w-48", sizeWidth: "w-14" },
  { id: "loading-row-4", nameWidth: "w-64", sizeWidth: "w-12" },
  { id: "loading-row-5", nameWidth: "w-44", sizeWidth: "w-16" },
  { id: "loading-row-6", nameWidth: "w-52", sizeWidth: "w-14" },
  { id: "loading-row-7", nameWidth: "w-36", sizeWidth: "w-12" },
];
const TABLE_SHELL_CLASS =
  "rounded-2xl border border-border/60 bg-background/80 shadow-xs";
type NameSortDirection = "asc" | "desc";

function isFolder(file: DriveFile) {
  return file.mimeType === FOLDER_MIME;
}

function formatSize(bytes: string | undefined) {
  if (!bytes) return "—";
  const n = Number(bytes);
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function NowPlayingBars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="6" width="3" height="10" rx="1">
        <animate
          attributeName="height"
          values="10;4;8;10"
          dur="0.9s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values="6;12;8;6"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="6.5" y="2" width="3" height="14" rx="1">
        <animate
          attributeName="height"
          values="14;6;10;14"
          dur="0.7s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values="2;10;6;2"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </rect>
      <rect x="12" y="4" width="3" height="12" rx="1">
        <animate
          attributeName="height"
          values="12;8;4;12"
          dur="1.1s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values="4;8;12;4"
          dur="1.1s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
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

export function FileList({
  files,
  loading,
  accessToken,
  folderStack,
  onFolderClick,
}: FileListProps) {
  const playTrack = usePlayerStore((state) => state.playTrack);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const [nameSortDirection, setNameSortDirection] =
    useState<NameSortDirection>("asc");
  const currentTrackId = currentTrack?.id;
  const playingFolderStack = usePlayerStore(
    (state) => state.playingFolderStack,
  );
  const playingFolderIds = new Set(playingFolderStack.map((f) => f.id));
  const sortedFiles = useMemo(
    () => sortFilesByName(files, nameSortDirection),
    [files, nameSortDirection],
  );
  const mp3s = sortedFiles.filter((file) => !isFolder(file));

  if (loading) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn(currentTrack ? "pb-32 md:pb-36" : "pb-6")}>
          <div className={TABLE_SHELL_CLASS}>
            <Table aria-label="Loading files">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-4">
                    <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                      Name
                    </span>
                  </TableHead>
                  <TableHead className="h-11 w-[96px] px-4 text-right">
                    <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                      Size
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LOADING_ROWS.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-0">
                      <div className="flex items-center gap-3 px-2 py-1.5">
                        <Skeleton className="size-4 rounded-sm" />
                        <Skeleton
                          className={cn("h-4 rounded-full", row.nameWidth)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <Skeleton
                          className={cn("h-4 rounded-full", row.sizeWidth)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <span>Nothing here yet</span>
        <span className="text-sm">
          Add MP3 files to this folder in Google Drive to see them here.
        </span>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn(currentTrack ? "pb-32 md:pb-36" : "pb-6")}>
        <div className={TABLE_SHELL_CLASS}>
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
                <TableHead className="h-11 w-[96px] px-4 text-right">
                  <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                    Size
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFiles.map((file) => {
                const folder = isFolder(file);
                const isActive = currentTrackId === file.id;
                const isPlayingAncestor =
                  folder && currentTrackId && playingFolderIds.has(file.id);
                const onActivate = () =>
                  folder
                    ? onFolderClick(file.id, file.name)
                    : playTrack(file, mp3s, accessToken, folderStack);

                return (
                  <TableRow
                    key={file.id}
                    data-active={isActive || undefined}
                    tabIndex={0}
                    role="button"
                    aria-label={
                      folder ? `Open folder ${file.name}` : `Play ${file.name}`
                    }
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={onActivate}
                    onKeyDown={(event) => onRowKeyDown(event, onActivate)}
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
                            isPlayingAncestor
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        >
                          {isPlayingAncestor ? (
                            <NowPlayingBars className="size-4" />
                          ) : folder ? (
                            <Folder className="size-4" />
                          ) : (
                            <Music4 className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {file.name}
                          </span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {folder ? "—" : formatSize(file.size)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </ScrollArea>
  );
}
