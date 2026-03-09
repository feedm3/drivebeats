"use client";

import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/library-store";

interface FavoriteToggleButtonProps {
  fileId: string;
  fileName: string;
  className?: string;
  iconClassName?: string;
  size?: "icon-xs" | "icon-sm";
}

export function FavoriteToggleButton({
  fileId,
  fileName,
  className,
  iconClassName,
  size = "icon-xs",
}: FavoriteToggleButtonProps) {
  const isFavorite = useLibraryStore((state) =>
    Boolean(state.tracks[fileId]?.isFavorite),
  );
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);

  return (
    <IconTooltip
      label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      side="left"
    >
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={cn(
          "text-muted-foreground transition-colors hover:text-foreground",
          isFavorite && "text-primary hover:text-primary",
          className,
          isFavorite && "opacity-100 md:opacity-100",
        )}
        aria-label={
          isFavorite
            ? `Remove ${fileName} from favorites`
            : `Add ${fileName} to favorites`
        }
        aria-pressed={isFavorite}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavorite({ fileId, fileName });
        }}
      >
        <Heart
          className={cn(
            "size-3.5",
            isFavorite && "fill-current",
            iconClassName,
          )}
        />
      </Button>
    </IconTooltip>
  );
}
