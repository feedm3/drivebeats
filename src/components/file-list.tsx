"use client";

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
import type { DriveFile } from "@/types";

interface FileListProps {
  files: DriveFile[];
  loading: boolean;
  accessToken: string;
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
const TABLE_SCROLL_PADDING_CLASS = "pb-32 md:pb-36";

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

export function FileList({
  files,
  loading,
  accessToken,
  onFolderClick,
}: FileListProps) {
  const playTrack = usePlayerStore((state) => state.playTrack);
  const currentTrackId = usePlayerStore((state) => state.currentTrack?.id);
  const mp3s = files.filter((file) => !isFolder(file));

  if (loading) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className={TABLE_SCROLL_PADDING_CLASS}>
          <div className={TABLE_SHELL_CLASS}>
            <Table aria-label="Loading files">
              <TableHeader className="[&_tr]:border-0">
                <TableRow className="h-0 border-0 hover:bg-transparent">
                  <TableHead className="h-0 p-0">
                    <span className="sr-only">Name</span>
                  </TableHead>
                  <TableHead className="h-0 w-[96px] p-0 text-right">
                    <span className="sr-only">Size</span>
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
      <div className={TABLE_SCROLL_PADDING_CLASS}>
        <div className={TABLE_SHELL_CLASS}>
          <Table aria-label="Files and folders">
            <TableHeader className="[&_tr]:border-0">
              <TableRow className="h-0 border-0 hover:bg-transparent">
                <TableHead className="h-0 p-0">
                  <span className="sr-only">Name</span>
                </TableHead>
                <TableHead className="h-0 w-[96px] p-0 text-right">
                  <span className="sr-only">Size</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => {
                const folder = isFolder(file);
                const isActive = currentTrackId === file.id;
                const onActivate = () =>
                  folder
                    ? onFolderClick(file.id, file.name)
                    : playTrack(file, mp3s, accessToken);

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
                        <span className="text-muted-foreground shrink-0">
                          {folder ? (
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
