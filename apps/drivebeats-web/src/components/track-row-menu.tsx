"use client";

import {
  ArrowDown,
  ArrowUp,
  Heart,
  Info,
  ListEnd,
  ListStart,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AddToPlaylistPopover } from "@/components/add-to-playlist-popover";
import { Button } from "@/components/ui/button";
import {
  POPOVER_MENU_ITEM_CLASS,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createPlaylistTrack } from "@/lib/audio";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { type DriveFile, FOLDER_MIME, type FolderEntry } from "@/types";

export function TrackRowMenu({
  file,
  folderStack,
  onDetails,
  detailsOpen,
  detailsId = `track-details-${file.id}`,
  favoriteVisibility = "mobile",
  onRemove,
  removeLabel,
  onMoveUp,
  onMoveDown,
}: {
  file: DriveFile;
  folderStack?: FolderEntry[];
  onDetails: () => void;
  detailsOpen: boolean;
  detailsId?: string;
  favoriteVisibility?: "mobile" | "always" | "never";
  onRemove?: () => void;
  removeLabel?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const favorite = useLibraryStore((state) =>
    Boolean(state.tracks[file.id]?.isFavorite),
  );
  const folder = file.mimeType === FOLDER_MIME;
  function queue(position: "next" | "end") {
    usePlayerStore.getState().queueTrack(file, position, folderStack);
    setOpen(false);
    toast.success(position === "next" ? "Will play next" : "Added to queue");
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-11"
            aria-label={`More options for ${file.name}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="end"
          className="max-h-(--available-height) overflow-y-auto"
          aria-label={`Options for ${file.name}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {!folder && favoriteVisibility !== "never" ? (
            <button
              type="button"
              className={cn(
                POPOVER_MENU_ITEM_CLASS,
                "min-h-11",
                favoriteVisibility === "mobile" && "sm:hidden",
              )}
              onClick={() => {
                void useLibraryStore
                  .getState()
                  .toggleFavorite(createPlaylistTrack(file));
                setOpen(false);
              }}
            >
              <Heart className={cn("size-4", favorite && "fill-current")} />
              {favorite ? "Remove from favorites" : "Add to favorites"}
            </button>
          ) : null}
          <AddToPlaylistPopover file={file} menuItem />
          {!folder ? (
            <>
              <button
                type="button"
                className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
                onClick={() => queue("next")}
              >
                <ListStart className="size-4" />
                Play next
              </button>
              <button
                type="button"
                className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
                onClick={() => queue("end")}
              >
                <ListEnd className="size-4" />
                Add to queue
              </button>
              <button
                type="button"
                className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
                aria-expanded={detailsOpen}
                aria-controls={detailsOpen ? detailsId : undefined}
                onClick={() => {
                  onDetails();
                  setOpen(false);
                }}
              >
                <Info className="size-4" />
                {detailsOpen ? "Hide track details" : "Track details"}
              </button>
            </>
          ) : null}
          {onMoveUp ? (
            <button
              type="button"
              className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
              onClick={() => {
                onMoveUp();
                setOpen(false);
              }}
            >
              <ArrowUp className="size-4" />
              Move up
            </button>
          ) : null}
          {onMoveDown ? (
            <button
              type="button"
              className={cn(POPOVER_MENU_ITEM_CLASS, "min-h-11")}
              onClick={() => {
                onMoveDown();
                setOpen(false);
              }}
            >
              <ArrowDown className="size-4" />
              Move down
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className={cn(
                POPOVER_MENU_ITEM_CLASS,
                "min-h-11 text-destructive",
              )}
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
            >
              <X className="size-4" />
              {removeLabel}
            </button>
          ) : null}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
