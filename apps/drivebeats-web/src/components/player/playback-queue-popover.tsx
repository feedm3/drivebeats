"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { AudioLines, ListMusic, X } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getPlaybackQueueTracks } from "@/lib/playback-queue";
import { resolveTrackMetadata } from "@/lib/track-metadata";
import { cn } from "@/lib/utils";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

type SessionQueueTrack = ReturnType<typeof getPlaybackQueueTracks>[number];

function QueueTrackLabel({ track }: { track: DriveFile }) {
  const metadata = useId3MetadataStore((state) => state.cache[track.id]);
  const { title, subtitle } = resolveTrackMetadata(
    track.name,
    track.parentFolderName,
    metadata,
  );

  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-medium">{title}</span>
      {subtitle ? (
        <span className="truncate text-muted-foreground">{subtitle}</span>
      ) : null}
    </span>
  );
}

function QueueList({
  tracks,
  scrollRef,
}: {
  tracks: SessionQueueTrack[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const removeQueuedTrack = usePlayerStore((state) => state.removeQueuedTrack);
  const playQueueEntry = usePlayerStore((state) => state.playQueueEntry);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.max(50, tracks.findIndex((track) => track.status === "current") + 21),
  );

  // Reveal the current row once on opening; playback changes never pull the
  // list away from a person browsing earlier or later tracks.
  useEffect(() => {
    const row = currentRowRef.current;
    const scroll = scrollRef.current;
    if (!row || !scroll) return;
    const frame = requestAnimationFrame(() => {
      const rowBounds = row.getBoundingClientRect();
      const scrollBounds = scroll.getBoundingClientRect();
      scroll.scrollTop +=
        rowBounds.top -
        scrollBounds.top -
        (scroll.clientHeight - rowBounds.height) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRef]);

  return tracks.length > 0 ? (
    <>
      <ol className="flex flex-col gap-1 py-2">
        {tracks
          .slice(0, visibleCount)
          .map(({ entryId, track, status, removable }, index) => (
            <li
              key={entryId}
              ref={status === "current" ? currentRowRef : undefined}
              data-queue-entry={entryId}
              data-status={status}
              className={cn(
                "flex min-h-14 min-w-0 items-center rounded-md text-sm",
                status === "current" && "bg-accent/60",
                status === "played" && "text-muted-foreground",
              )}
            >
              <button
                type="button"
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left text-base outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm"
                aria-current={status === "current" ? "true" : undefined}
                aria-label={`Play ${track.name}${status === "current" ? ", current track" : status === "played" ? ", played" : ""}`}
                onClick={() => void playQueueEntry(entryId)}
              >
                <span
                  aria-hidden="true"
                  className="flex w-5 shrink-0 justify-center tabular-nums"
                >
                  {status === "current" ? (
                    <AudioLines className="size-4 shrink-0 stroke-primary" />
                  ) : (
                    index + 1
                  )}
                </span>
                <QueueTrackLabel track={track} />
              </button>
              {removable ? (
                <div className="flex w-12 shrink-0 justify-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`Remove ${track.name} from queue`}
                    onClick={() => removeQueuedTrack(entryId)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
      </ol>
      {tracks.length > visibleCount ? (
        <Button
          variant="ghost"
          className="min-h-11 w-full"
          onClick={() => setVisibleCount((count) => count + 50)}
        >
          Show more tracks
        </Button>
      ) : null}
    </>
  ) : (
    <div className="flex flex-col gap-1 py-5">
      <p className="text-base font-medium sm:text-sm">Your queue is empty</p>
      <p className="text-pretty text-sm text-muted-foreground">
        Play a track or use Add to queue to start listening.
      </p>
    </div>
  );
}

function QueueContents() {
  const playbackSequence = usePlayerStore((state) => state.playbackSequence);
  const playbackCursor = usePlayerStore((state) => state.playbackCursor);
  const repeat = usePlayerStore((state) => state.repeat);
  const clearQueuedTracks = usePlayerStore((state) => state.clearQueuedTracks);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracks = useMemo(
    () => getPlaybackQueueTracks({ playbackSequence, playbackCursor }),
    [playbackSequence, playbackCursor],
  );
  const hasAdditions = tracks.some((entry) => entry.removable);

  return (
    <PopoverContent
      side="top"
      align="end"
      sideOffset={8}
      data-playback-queue
      className="flex max-h-[min(65dvh,var(--available-height))] w-96 max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <PopoverPrimitive.Title className="text-base font-semibold sm:text-sm">
          Queue
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
      <div
        ref={scrollRef}
        data-queue-scroll
        className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
      >
        {repeat === "one" ? (
          <p className="px-2 pt-3 text-pretty text-sm text-muted-foreground">
            Repeat one is on. Use Next to advance.
          </p>
        ) : null}
        <QueueList tracks={tracks} scrollRef={scrollRef} />
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
