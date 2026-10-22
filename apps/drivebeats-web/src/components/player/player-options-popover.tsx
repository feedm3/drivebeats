"use client";

import { Heart, MoreHorizontal, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { AddToPlaylistPopover } from "@/components/add-to-playlist-popover";
import { Button } from "@/components/ui/button";
import {
  POPOVER_MENU_ITEM_CLASS,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { createPlaylistTrack } from "@/lib/audio";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

export function PlayerOptionsPopover({ track }: { track: DriveFile | null }) {
  const [open, setOpen] = useState(false);
  const favorite = useLibraryStore((state) =>
    Boolean(track && state.tracks[track.id]?.isFavorite),
  );
  const volume = usePlayerStore((state) => state.volume);
  const isMuted = usePlayerStore((state) => state.isMuted);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);
  const muted = isMuted || volume === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Player options"
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="end"
          side="top"
          className="max-h-(--available-height) overflow-y-auto sm:hidden"
          aria-label="Player options"
          data-player-options
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
          }}
        >
          {track ? (
            <>
              <button
                type="button"
                className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
                onClick={() => {
                  void useLibraryStore
                    .getState()
                    .toggleFavorite(createPlaylistTrack(track));
                  setOpen(false);
                }}
              >
                <Heart
                  aria-hidden="true"
                  className={cn("size-4", favorite && "fill-current")}
                />
                {favorite ? "Remove from favorites" : "Add to favorites"}
              </button>
              <AddToPlaylistPopover file={track} menuItem />
            </>
          ) : null}
          <div className="standalone:hidden">
            {track ? <Separator className="my-1" /> : null}
            <button
              type="button"
              className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
              aria-pressed={muted}
              onClick={() => (volume === 0 ? setVolume(0.7) : toggleMute())}
            >
              {muted ? (
                <VolumeX aria-hidden="true" className="size-4" />
              ) : (
                <Volume2 aria-hidden="true" className="size-4" />
              )}
              {muted ? "Unmute" : "Mute"}
            </button>
            <div className="flex min-h-11 items-center gap-3 px-2">
              <span className="text-xs text-muted-foreground">Volume</span>
              <Slider
                aria-label="Volume"
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.01}
                onValueChange={(value) =>
                  setVolume(Array.isArray(value) ? value[0] : value)
                }
                className="group min-w-0 flex-1"
              />
            </div>
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
