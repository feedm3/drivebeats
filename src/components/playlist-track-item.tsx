"use client";

import { GripVertical, Music4, X } from "lucide-react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";
import type { PlaylistTrack } from "@/types";

interface PlaylistTrackItemProps {
  track: PlaylistTrack;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  dropIndicator: "above" | "below" | null;
  isReorderable?: boolean;
  onPlay: () => void;
  onRemove: () => void;
  removeLabel?: string;
}

export function PlaylistTrackItem({
  track,
  index,
  isActive,
  isPlaying,
  isDragging,
  dropIndicator,
  isReorderable = true,
  onPlay,
  onRemove,
  removeLabel = "Remove from playlist",
}: PlaylistTrackItemProps) {
  return (
    <div
      data-track-index={index}
      data-active={isActive ? true : undefined}
      className={cn(
        "group relative flex items-center border-b py-4 transition-colors hover:bg-muted/50 data-[active]:bg-primary/6 last:border-b-0",
        isDragging && "opacity-30",
      )}
    >
      {dropIndicator === "above" && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-primary" />
      )}
      {dropIndicator === "below" && (
        <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-primary" />
      )}
      {isReorderable ? (
        <button
          type="button"
          className="flex shrink-0 items-center justify-center w-9 self-stretch cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          data-drag-handle
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <div className="w-4 shrink-0" aria-hidden="true" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Play ${track.fileName}`}
        onClick={onPlay}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPlay();
          }
        }}
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
          <span className="block truncate text-sm font-medium">
            {track.fileName}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center pr-2">
        <IconTooltip label={removeLabel} side="left">
          <Button
            variant="ghost"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label={`${removeLabel} ${track.fileName}`}
          >
            <X className="size-3.5" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}
