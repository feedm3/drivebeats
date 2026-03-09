"use client";

import { Folder, Heart, Music4, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const LOADING_ROWS = [
  {
    id: "loading-folder-1",
    type: "folder" as const,
    nameWidth: "w-40",
    sizeWidth: null,
  },
  {
    id: "loading-folder-2",
    type: "folder" as const,
    nameWidth: "w-52",
    sizeWidth: null,
  },
  {
    id: "loading-track-1",
    type: "track" as const,
    nameWidth: "w-56",
    sizeWidth: "w-14",
  },
  {
    id: "loading-track-2",
    type: "track" as const,
    nameWidth: "w-44",
    sizeWidth: "w-12",
  },
  {
    id: "loading-folder-3",
    type: "folder" as const,
    nameWidth: "w-36",
    sizeWidth: null,
  },
  {
    id: "loading-track-3",
    type: "track" as const,
    nameWidth: "w-48",
    sizeWidth: "w-16",
  },
  {
    id: "loading-track-4",
    type: "track" as const,
    nameWidth: "w-52",
    sizeWidth: "w-14",
  },
];

export const FILE_TABLE_SHELL_CLASS =
  "rounded-2xl border border-border/60 bg-background/80 shadow-xs";

export function FileListSkeleton() {
  return (
    <div className={FILE_TABLE_SHELL_CLASS}>
      <Table aria-label="Loading files">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-11 px-4">
              <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                Name
              </span>
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
          {LOADING_ROWS.map((row) => {
            const Icon = row.type === "folder" ? Folder : Music4;

            return (
              <TableRow key={row.id}>
                <TableCell className="max-w-0">
                  <div className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left">
                    <span className="shrink-0 text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <Skeleton
                      className={cn("h-4 rounded-full", row.nameWidth)}
                    />
                  </div>
                </TableCell>
                <TableCell className="w-9 px-0.5">
                  <div className="flex justify-center">
                    <div className="flex size-8 items-center justify-center rounded-md text-muted-foreground/35">
                      {row.type === "folder" ? null : (
                        <Heart className="size-3.5" />
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-9 px-0.5">
                  <div className="flex justify-center">
                    <div className="flex size-8 items-center justify-center rounded-md text-muted-foreground/35">
                      <Plus className="size-3.5" />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {row.type === "folder" ? (
                    "—"
                  ) : (
                    <div className="flex justify-end">
                      <Skeleton
                        className={cn("h-4 rounded-full", row.sizeWidth)}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
