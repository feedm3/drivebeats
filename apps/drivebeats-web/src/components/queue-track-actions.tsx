"use client";

import { ListEnd, ListPlus, ListStart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  POPOVER_MENU_ITEM_CLASS,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";

export function QueueTrackActions({
  track,
  folderStack,
  className,
}: {
  track: DriveFile;
  folderStack?: FolderEntry[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function add(position: "next" | "end") {
    usePlayerStore.getState().queueTrack(track, position, folderStack);
    setOpen(false);
    toast.success(position === "next" ? "Will play next" : "Added to queue");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("size-11", className)}
            aria-label={`Queue ${track.name}`}
            title="Queue track"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        }
      >
        <ListPlus aria-hidden="true" />
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="end"
          aria-label={`Queue ${track.name}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
            onClick={() => add("next")}
          >
            <ListStart className="size-4" aria-hidden="true" />
            Play next
          </button>
          <button
            type="button"
            className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
            onClick={() => add("end")}
          >
            <ListEnd className="size-4" aria-hidden="true" />
            Add to queue
          </button>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
