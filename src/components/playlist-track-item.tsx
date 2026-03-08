"use client";

import { GripVertical, Music4, X } from "lucide-react";
import { useRef, useState } from "react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { PlaylistTrack } from "@/types";

interface PlaylistTrackItemProps {
  track: PlaylistTrack;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent) => void;
  dropPosition: "above" | "below" | null;
}

export function PlaylistTrackItem({
  track,
  index,
  isActive,
  isPlaying,
  onPlay,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  dropPosition,
}: PlaylistTrackItemProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <TableRow
      ref={rowRef}
      draggable
      className={cn(
        "group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 relative",
        isDragging && "opacity-50",
        dropPosition === "above" &&
          "before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:bg-primary",
        dropPosition === "below" &&
          "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary",
      )}
      data-active={isActive || undefined}
      tabIndex={0}
      role="button"
      aria-label={`Play ${track.fileName}`}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay();
        }
      }}
      onDragStart={(e) => {
        setIsDragging(true);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/drivebeats-reorder", String(index));
        onDragStart(index);
      }}
      onDragEnd={() => setIsDragging(false)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver(e, index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e);
      }}
    >
      <TableCell className="w-8 px-1">
        <GripVertical className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
      </TableCell>
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
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            {isActive ? (
              <NowPlayingBars className="size-4" paused={!isPlaying} />
            ) : (
              <Music4 className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{track.fileName}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="w-10 px-1">
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${track.fileName}`}
        >
          <X className="size-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
