"use client";

import {
  ArrowDown,
  Check,
  CircleAlert,
  GripVertical,
  Loader2,
  Music4,
  RotateCcw,
} from "lucide-react";
import { useId, useState } from "react";
import { FavoriteToggleButton } from "@/components/favorite-toggle-button";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { TrackRowMenu } from "@/components/track-row-menu";
import { useCachedTrackTags } from "@/hooks/use-cached-track-tags";
import { playlistTrackToDriveFile } from "@/lib/audio";
import { resolveTrackMetadata } from "@/lib/track-metadata";
import { cn, formatBytes } from "@/lib/utils";
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
  rowInfo?: string;
  rowInfoLabel?: string;
  isFavorites?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
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
  rowInfo,
  rowInfoLabel,
  isFavorites = false,
  onMoveUp,
  onMoveDown,
  onPlay,
  onRemove,
  removeLabel = "Remove from playlist",
}: PlaylistTrackItemProps) {
  const file = playlistTrackToDriveFile(track);
  const id3 = useCachedTrackTags(file);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const { title, subtitle: metadataSubtitle } = resolveTrackMetadata(
    track.fileName,
    track.parentFolderName,
    id3,
  );
  const desktopSubtitle = [metadataSubtitle, id3?.album]
    .filter(Boolean)
    .join(" · ");
  const offlineLabel = getOfflineLabel(offlineJob);
  const isActionRequiredFailure =
    offlineJob?.status === "failed" &&
    offlineJob.errorCategory !== undefined &&
    ACTION_REQUIRED_FAILURES.has(offlineJob.errorCategory);

  return (
    <>
      <div
        data-track-index={index}
        data-active={isActive ? true : undefined}
        className={cn(
          "group relative flex w-full min-w-0 cursor-pointer min-h-16 items-center transition-colors hover:bg-muted/50 data-[active]:bg-primary/6",
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
            className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center self-center touch-none text-muted-foreground opacity-100 transition-opacity cursor-grab active:cursor-grabbing md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100 md:pointer-fine:focus-visible:opacity-100"
            data-drag-handle
            onClick={(e) => e.stopPropagation()}
            aria-label={`Reorder ${track.fileName}`}
          >
            <GripVertical className="size-4" />
          </button>
        ) : (
          <div className="hidden w-3 shrink-0 sm:block" aria-hidden="true" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer min-h-16 items-center gap-3 overflow-hidden rounded-lg px-2 py-2 text-left"
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
                "shrink-0",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Music4 className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              <span className="sm:hidden">{metadataSubtitle}</span>
              <span className="hidden sm:inline" title={desktopSubtitle}>
                {desktopSubtitle}
              </span>
            </span>
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
        {rowInfo ? (
          <span
            className="hidden max-w-32 shrink-0 truncate px-2 text-xs tabular-nums text-muted-foreground sm:block"
            title={`${rowInfoLabel}: ${rowInfo}`}
          >
            {rowInfo}
          </span>
        ) : (
          <div className="hidden shrink-0 sm:block">
            <FavoriteToggleButton
              fileId={track.fileId}
              fileName={track.fileName}
              mimeType={file.mimeType}
              parents={track.parents}
              size="icon-sm"
              className="size-11"
            />
          </div>
        )}
        <div className="shrink-0 pr-3">
          <TrackRowMenu
            file={file}
            detailsOpen={detailsOpen}
            detailsId={detailsId}
            onDetails={() => setDetailsOpen((value) => !value)}
            favoriteVisibility={
              isFavorites ? "never" : rowInfo ? "always" : "mobile"
            }
            onRemove={onRemove}
            removeLabel={removeLabel}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </div>
      </div>
      {detailsOpen ? (
        <div id={detailsId} className="bg-muted/20 px-4 py-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
            {rowInfo ? (
              <>
                <dt className="text-muted-foreground">{rowInfoLabel}</dt>
                <dd>{rowInfo}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Album</dt>
            <dd className="break-words">{id3?.album || "No album tag"}</dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd>{track.size ? formatBytes(Number(track.size)) : "—"}</dd>
            <dt className="text-muted-foreground">File</dt>
            <dd className="break-words">{track.fileName}</dd>
          </dl>
        </div>
      ) : null}
    </>
  );
}
