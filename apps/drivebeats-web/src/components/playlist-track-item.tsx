"use client";

import {
  ArrowDown,
  Check,
  CircleAlert,
  GripVertical,
  Loader2,
  Music4,
  RotateCcw,
  X,
} from "lucide-react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { resolveTrackMetadata } from "@/lib/track-metadata";
import { cn } from "@/lib/utils";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import type {
  OfflineDownloadErrorCategory,
  OfflineTrackJob,
} from "@/stores/offline-store";
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
  offlineJob?: OfflineTrackJob;
  subtitle?: string;
  onPlay: () => void;
  onRemove: () => void;
  removeLabel?: string;
}

const FAILURE_REASONS: Record<OfflineDownloadErrorCategory, string> = {
  network: "Network unavailable. Reconnect, then retry.",
  timeout: "Download timed out. Try again.",
  "auth-required": "Sign in again, then retry.",
  "access-denied": "Drive access denied. Check the file permissions.",
  "missing-file": "This file is no longer available in Drive.",
  "rate-limited": "Drive is limiting downloads. Try again later.",
  server: "Drive is temporarily unavailable. Try again later.",
  "storage-full": "Not enough device storage. Free space, then retry.",
  "storage-unavailable":
    "Offline storage is unavailable. Reopen DriveBeats, then retry.",
  integrity: "The downloaded file was incomplete. Try again.",
  unknown: "Download could not be completed. Try again or copy diagnostics.",
};

const ACTION_REQUIRED_FAILURES = new Set<OfflineDownloadErrorCategory>([
  "auth-required",
  "access-denied",
  "missing-file",
  "storage-full",
  "storage-unavailable",
]);

function getOfflineLabel(job: OfflineTrackJob | undefined) {
  if (!job) return null;

  if (job.status === "downloaded") return "Downloaded";
  if (job.status === "queued") return "Waiting to download";
  if (job.status === "failed") {
    return job.errorCategory
      ? FAILURE_REASONS[job.errorCategory]
      : "Download failed. Try again.";
  }
  if (job.phase === "authorizing") return "Preparing download";
  if (job.phase === "reading") return "Processing download";
  if (job.phase === "storing") return "Saving for offline";
  return job.status === "updating" ? "Updating download" : "Downloading";
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
  offlineJob,
  subtitle,
  onPlay,
  onRemove,
  removeLabel = "Remove from playlist",
}: PlaylistTrackItemProps) {
  const id3 = useId3MetadataStore((s) => s.cache[track.fileId]);
  const { title, subtitle: metadataSubtitle } = resolveTrackMetadata(
    track.fileName,
    track.parentFolderName,
    id3,
  );
  const offlineLabel = getOfflineLabel(offlineJob);
  const isActionRequiredFailure =
    offlineJob?.status === "failed" &&
    offlineJob.errorCategory !== undefined &&
    ACTION_REQUIRED_FAILURES.has(offlineJob.errorCategory);

  return (
    <div
      data-track-index={index}
      data-active={isActive ? true : undefined}
      className={cn(
        "group relative flex w-full min-w-0 cursor-pointer items-center py-2 transition-colors hover:bg-muted/50 data-[active]:bg-primary/6",
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
          className="flex h-11 w-11 shrink-0 items-center justify-center self-center touch-none text-muted-foreground opacity-100 transition-opacity cursor-grab active:cursor-grabbing md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100 md:pointer-fine:focus-visible:opacity-100"
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
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-2 py-2 text-left"
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
          {offlineJob?.status === "failed" && offlineLabel && (
            <span
              className={cn(
                "block text-xs",
                isActionRequiredFailure
                  ? "text-destructive"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              {offlineLabel}
            </span>
          )}
        </span>
        {offlineJob && offlineLabel && (
          <span
            className={cn(
              "shrink-0 ml-1",
              offlineJob.status === "downloaded"
                ? "text-emerald-500"
                : offlineJob.status === "failed"
                  ? isActionRequiredFailure
                    ? "text-destructive"
                    : "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
            )}
            title={offlineLabel}
            role="img"
            aria-label={offlineLabel}
          >
            {offlineJob.status === "downloaded" ? (
              <Check aria-hidden="true" className="size-3" />
            ) : offlineJob.status === "downloading" ||
              offlineJob.status === "updating" ? (
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            ) : offlineJob.status === "failed" ? (
              isActionRequiredFailure ? (
                <CircleAlert aria-hidden="true" className="size-3" />
              ) : (
                <RotateCcw aria-hidden="true" className="size-3" />
              )
            ) : (
              <ArrowDown aria-hidden="true" className="size-3" />
            )}
          </span>
        )}
      </button>
      {subtitle && (
        <span className="max-w-28 shrink-0 truncate px-2 text-xs tabular-nums text-muted-foreground">
          {subtitle}
        </span>
      )}
      {/* On coarse pointers the 24px remove button carries a 44px `touch-target`
          overlay. Without a slot wide enough to contain it, that overlay hangs
          10px over the neighbouring play target and — painting later — would
          turn a tap near the row edge into a removal. `w-14` plus centring keeps
          the whole hit area inside this slot. */}
      <div className="flex shrink-0 items-center pr-2 pointer-coarse:w-14 pointer-coarse:justify-center">
        <IconTooltip label={removeLabel} side="left">
          <Button
            variant="ghost"
            size="icon-xs"
            // Was hover-only, so on a phone the remove action could never be
            // reached. Same rule as the drag handle and the file-list row
            // actions: visible by default, hidden until hover only where a
            // hovering pointer actually exists.
            className="opacity-100 md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100 md:pointer-fine:focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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
