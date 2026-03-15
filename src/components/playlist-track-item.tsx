"use client";

import { CheckCircle2, GripVertical, Music4, X } from "lucide-react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { OfflineToggleButton } from "@/components/offline-toggle-button";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { getTrackDisplayName } from "@/lib/audio";
import { cn } from "@/lib/utils";
import { useOfflineStore } from "@/stores/offline-store";
import type { DriveFile, PlaylistTrack } from "@/types";

interface PlaylistTrackItemProps {
  track: PlaylistTrack;
  index: number;
  isActive: boolean;
  isCurrentlyPlaying: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  dropIndicator: "above" | "below" | null;
  isReorderable?: boolean;
  subtitle?: string;
  onPlay: () => void;
  onRemove: () => void;
  removeLabel?: string;
}

function toDriveFile(track: PlaylistTrack): DriveFile {
  return {
    id: track.fileId,
    name: track.fileName,
    mimeType: track.mimeType ?? "audio/mpeg",
    size: track.size,
    parents: track.parents,
  };
}

export function PlaylistTrackItem({
  track,
  index,
  isActive,
  isCurrentlyPlaying,
  isPlaying,
  isDragging,
  dropIndicator,
  isReorderable = true,
  subtitle,
  onPlay,
  onRemove,
  removeLabel = "Remove from playlist",
}: PlaylistTrackItemProps) {
  const isCached = useOfflineStore(
    (state) => state.items[track.fileId]?.status === "cached",
  );

  return (
    <div
      data-track-index={index}
      data-active={isActive ? true : undefined}
      className={cn(
        "group relative flex cursor-pointer items-center border-b py-4 transition-colors hover:bg-muted/50 data-[active]:bg-primary/6 last:border-b-0",
        isDragging && "opacity-30",
      )}
      tabIndex={0}
      role="button"
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay();
        }
      }}
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
          className="flex w-9 shrink-0 cursor-grab items-center justify-center self-stretch text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          data-drag-handle
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <div className="w-4 shrink-0" aria-hidden="true" />
      )}
      <div
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left"
        aria-label={`Play ${track.fileName}`}
      >
        <span
          className={cn(
            "shrink-0",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          {isCurrentlyPlaying ? (
            <NowPlayingBars className="size-4" paused={!isPlaying} />
          ) : (
            <Music4 className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {getTrackDisplayName(track.fileName)}
          </span>
        </span>
        {isCached ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : null}
      </div>
      {subtitle && (
        <span className="shrink-0 px-2 text-xs tabular-nums text-muted-foreground">
          {subtitle}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1 pr-2">
        <OfflineToggleButton file={toDriveFile(track)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100" />
        <IconTooltip label={removeLabel} side="left">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
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
