"use client";

import { GripVertical, Music4, X } from "lucide-react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlaylistTrack } from "@/types";

interface PlaylistTrackItemProps {
  track: PlaylistTrack;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  dropIndicator: "above" | "below" | null;
  onPlay: () => void;
  onRemove: () => void;
}

export function PlaylistTrackItem({
  track,
  index,
  isActive,
  isPlaying,
  isDragging,
  dropIndicator,
  onPlay,
  onRemove,
}: PlaylistTrackItemProps) {
  return (
    <div
      data-track-index={index}
      className={cn(
        "group relative flex items-center border-b border-border/40 transition-colors hover:bg-muted/50",
        isActive && "bg-primary/6",
        isDragging && "opacity-30",
      )}
    >
      {dropIndicator === "above" && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-primary" />
      )}
      {dropIndicator === "below" && (
        <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-primary" />
      )}
      <div
        className="flex shrink-0 items-center justify-center w-9 self-stretch cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        data-drag-handle
      >
        <GripVertical className="size-4" />
      </div>
      <div
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 pr-1"
        role="button"
        tabIndex={0}
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
      </div>
      <div className="flex shrink-0 items-center pr-2">
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
      </div>
    </div>
  );
}
