"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { ListMusic, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getUpcomingTracks, type UpcomingTrack } from "@/lib/playback-queue";
import { resolveTrackMetadata } from "@/lib/track-metadata";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

function QueueTrackLabel({ track }: { track: DriveFile }) {
  const metadata = useId3MetadataStore((state) => state.cache[track.id]);
  const { title, subtitle } = resolveTrackMetadata(
    track.name,
    track.parentFolderName,
    metadata,
  );

  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{title}</span>
      {subtitle ? (
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}

function QueueList({ upcoming }: { upcoming: UpcomingTrack[] }) {
  const removeQueuedTrack = usePlayerStore((state) => state.removeQueuedTrack);
  const [visibleCount, setVisibleCount] = useState(40);

  return upcoming.length > 0 ? (
    <>
      <ol className="flex flex-col">
        {upcoming.slice(0, visibleCount).map(({ entryId, track }, index) => (
          <li
            key={entryId ?? `source:${track.id}`}
            className="flex min-h-14 min-w-0 items-center gap-3 border-b border-border/50 py-2 last:border-0"
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <QueueTrackLabel track={track} />
            {entryId ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={`Remove ${track.name} from queue`}
                onClick={() => removeQueuedTrack(entryId)}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {upcoming.length > visibleCount ? (
        <Button
          variant="ghost"
          className="mt-2 min-h-11 w-full"
          onClick={() => setVisibleCount((count) => count + 40)}
        >
          Show more tracks
        </Button>
      ) : null}
    </>
  ) : (
    <div className="py-5">
      <p className="text-sm font-medium">Nothing queued next</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Use Play next or Add to queue on a track to keep listening.
      </p>
    </div>
  );
}

function QueueContents() {
  const playlist = usePlayerStore((state) => state.playlist);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const shuffleCycle = usePlayerStore((state) => state.shuffleCycle);
  const nextShuffleFileId = usePlayerStore((state) => state.nextShuffleFileId);
  const repeat = usePlayerStore((state) => state.repeat);
  const queuedTracks = usePlayerStore((state) => state.queuedTracks);
  const playingFolderStack = usePlayerStore(
    (state) => state.playingFolderStack,
  );
  const playlistFolderStacks = usePlayerStore(
    (state) => state.playlistFolderStacks,
  );
  const queuedPlaybackContext = usePlayerStore(
    (state) => state.queuedPlaybackContext,
  );
  const clearQueuedTracks = usePlayerStore((state) => state.clearQueuedTracks);
  const upcoming = useMemo(
    () =>
      getUpcomingTracks({
        playlist,
        currentIndex,
        shuffle,
        shuffleCycle,
        nextShuffleFileId,
        repeat,
        queuedTracks,
        playingFolderStack,
        playlistFolderStacks,
        queuedPlaybackContext,
      }),
    [
      playlist,
      currentIndex,
      shuffle,
      shuffleCycle,
      nextShuffleFileId,
      repeat,
      queuedTracks,
      playingFolderStack,
      playlistFolderStacks,
      queuedPlaybackContext,
    ],
  );
  const hasAdditions = upcoming.some((entry) => entry.entryId !== null);

  return (
    <PopoverContent
      side="top"
      align="end"
      sideOffset={8}
      data-playback-queue
      className="flex max-h-[min(65dvh,var(--available-height))] w-96 max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <PopoverPrimitive.Title className="text-sm font-semibold">
          Up next
        </PopoverPrimitive.Title>
        <div className="flex items-center gap-1">
          {hasAdditions ? (
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={clearQueuedTracks}
            >
              Clear additions
            </Button>
          ) : null}
          <PopoverPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Close queue"
              />
            }
          >
            <X aria-hidden="true" className="size-4" />
          </PopoverPrimitive.Close>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-3">
        {hasAdditions ? (
          <p className="pt-3 text-xs text-muted-foreground">
            Your additions play first. Clearing them keeps your current
            collection.
          </p>
        ) : null}
        {repeat === "one" ? (
          <p className="pt-3 text-xs text-muted-foreground">
            Repeat one is on. Use Next to advance.
          </p>
        ) : null}
        <QueueList upcoming={upcoming} />
      </div>
    </PopoverContent>
  );
}

export function PlaybackQueuePopover() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={open ? "secondary" : "ghost"}
            size="icon"
            className="size-11"
            aria-label="Queue"
          />
        }
      >
        <ListMusic aria-hidden="true" className="size-5" />
      </PopoverTrigger>
      {open ? <QueueContents /> : null}
    </Popover>
  );
}
