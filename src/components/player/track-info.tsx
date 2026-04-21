"use client";

import { resolveTrackMetadata } from "@/lib/track-metadata";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { usePlayerStore } from "@/stores/player-store";

interface TrackInfoProps {
  onNavigateToTrack?: () => void;
}

export function TrackInfo({ onNavigateToTrack }: TrackInfoProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playingFolderStack = usePlayerStore((s) => s.playingFolderStack);
  const canNavigate = onNavigateToTrack && playingFolderStack.length > 0;
  const id3 = useId3MetadataStore((s) =>
    currentTrack ? s.cache[currentTrack.id] : undefined,
  );
  const { title, subtitle } = resolveTrackMetadata(
    currentTrack?.name ?? "",
    currentTrack?.parentFolderName,
    id3,
  );

  if (!currentTrack) {
    return (
      <div className="min-w-0 flex-1">
        <span className="text-sm text-muted-foreground">No track playing</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
      <div
        key={currentTrack.id}
        className="min-w-0 flex-1 animate-in fade-in duration-200"
      >
        {canNavigate ? (
          <button
            type="button"
            className="block max-w-full truncate text-left text-sm font-semibold hover:underline"
            onClick={onNavigateToTrack}
          >
            {title}
          </button>
        ) : (
          <span className="block truncate text-sm font-semibold">{title}</span>
        )}
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
