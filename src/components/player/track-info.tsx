"use client";

import { FavoriteToggleButton } from "@/components/favorite-toggle-button";
import { getTrackDisplayName } from "@/lib/audio";
import { usePlayerStore } from "@/stores/player-store";

export function TrackInfo() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  if (!currentTrack) {
    return (
      <div className="min-w-0 flex-1">
        <span className="text-sm text-muted-foreground">No track playing</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded bg-accent text-muted-foreground">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </span>
      <div className="min-w-0 flex flex-1 items-center gap-1.5">
        <span className="truncate text-sm font-semibold">
          {getTrackDisplayName(currentTrack.name)}
        </span>
        <FavoriteToggleButton
          fileId={currentTrack.id}
          fileName={currentTrack.name}
          mimeType={currentTrack.mimeType}
          className="shrink-0 text-muted-foreground/80"
        />
      </div>
    </div>
  );
}
