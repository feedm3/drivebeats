"use client";

import { Folder, Heart, MoreHorizontal, Music4 } from "lucide-react";
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
  },
  {
    id: "loading-folder-2",
    type: "folder" as const,
    nameWidth: "w-52",
  },
  {
    id: "loading-folder-3",
    type: "folder" as const,
    nameWidth: "w-36",
  },
  {
    id: "loading-track-1",
    type: "track" as const,
    nameWidth: "w-56",
  },
  {
    id: "loading-track-2",
    type: "track" as const,
    nameWidth: "w-44",
  },
  {
    id: "loading-track-3",
    type: "track" as const,
    nameWidth: "w-48",
  },
  {
    id: "loading-track-4",
    type: "track" as const,
    nameWidth: "w-52",
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
            <TableHead className="h-11 px-2 sm:px-4">
              <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                Name
              </span>
            </TableHead>
            <TableHead className="hidden h-11 w-11 px-0 sm:table-cell" />
            <TableHead className="h-11 w-14 pl-0 pr-3" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {LOADING_ROWS.map((row) => {
            const Icon = row.type === "folder" ? Folder : Music4;

            return (
              <TableRow key={row.id}>
                <TableCell className="max-w-0 p-0 sm:px-3 sm:py-0">
                  <div className="flex min-h-16 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left">
                    <span className="shrink-0 text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <Skeleton
                      className={cn("h-4 rounded-full", row.nameWidth)}
                    />
                  </div>
                </TableCell>
                <TableCell className="hidden w-11 px-0 py-0 sm:table-cell">
                  <div className="flex justify-center">
                    <div className="flex size-8 items-center justify-center rounded-md text-muted-foreground/35">
                      {row.type === "folder" ? null : (
                        <Heart className="size-3.5" />
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-14 py-0 pl-0 pr-3">
                  <div className="flex justify-center">
                    <div className="flex size-8 items-center justify-center rounded-md text-muted-foreground/35">
                      <MoreHorizontal className="size-3.5" />
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
