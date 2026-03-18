"use client";

import {
  ArrowDown,
  Check,
  GripVertical,
  Loader2,
  Music4,
  X,
} from "lucide-react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { parseTrackMetadata } from "@/lib/track-metadata";
import { cn } from "@/lib/utils";
import type { OfflineTrackStatus } from "@/stores/offline-store";
import type { PlaylistTrack } from "@/types";

interface PlaylistTrackItemProps {
  track: PlaylistTrack;
  index: number;
  isActive: boolean;
  isCurrentlyPlaying: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  dropIndicator: "above" | "below" | null;
  isReorderable?: boolean;
  offlineStatus?: OfflineTrackStatus;
  subtitle?: string;
  onPlay: () => void;
  onRemove: () => void;
  removeLabel?: string;
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
  offlineStatus,
  subtitle,
  onPlay,
  onRemove,
  removeLabel = "Remove from playlist",
}: PlaylistTrackItemProps) {
  const { title, subtitle: metadataSubtitle } = parseTrackMetadata(
    track.fileName,
    track.parentFolderName,
  );

  return (
    <div
      data-track-index={index}
      data-active={isActive ? true : undefined}
      className={cn(
        "group relative flex cursor-pointer items-center border-b py-2 transition-colors hover:bg-muted/50 data-[active]:bg-primary/6 last:border-b-0",
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
          className="flex h-11 w-11 shrink-0 items-center justify-center self-center touch-none text-muted-foreground opacity-100 transition-opacity cursor-grab active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          data-drag-handle
          onClick={(e) => e.stopPropagation()}
          aria-label={`Reorder ${track.fileName}`}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <div className="w-4 shrink-0" aria-hidden="true" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left"
        aria-label={`Play ${track.fileName}`}
        onClick={onPlay}
      >
        {isCurrentlyPlaying ? (
          <span
            className={cn(
              "shrink-0",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <NowPlayingBars className="size-4" paused={!isPlaying} />
          </span>
        ) : (
          <span
            className={cn(
              "hidden shrink-0 md:inline-flex",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Music4 className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {metadataSubtitle && (
            <span className="block truncate text-xs text-muted-foreground">
              {metadataSubtitle}
            </span>
          )}
        </span>
        {offlineStatus && (
          <span
            className={cn(
              "shrink-0 ml-1",
              offlineStatus === "downloaded"
                ? "text-emerald-500"
                : offlineStatus === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
            title={
              offlineStatus === "downloaded"
                ? "Downloaded"
                : offlineStatus === "downloading" ||
                    offlineStatus === "updating"
                  ? "Downloading"
                  : offlineStatus === "failed"
                    ? "Download failed"
                    : "Queued"
            }
          >
            {offlineStatus === "downloaded" ? (
              <Check className="size-3" />
            ) : offlineStatus === "downloading" ||
              offlineStatus === "updating" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : offlineStatus === "failed" ? (
              <X className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )}
          </span>
        )}
      </button>
      {subtitle && (
        <span className="shrink-0 px-2 text-xs tabular-nums text-muted-foreground">
          {subtitle}
        </span>
      )}
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
