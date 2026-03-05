"use client";

import { usePlayerStore } from "@/stores/player-store";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PlayControls() {
  const {
    isPlaying,
    isLoading,
    shuffle,
    repeat,
    togglePlay,
    next,
    previous,
    toggleShuffle,
    cycleRepeat,
    currentTrack,
  } = usePlayerStore();
  const getValidAccessToken = useAuthStore((s) => s.getValidAccessToken);

  const handleNext = async () => {
    const token = await getValidAccessToken();
    if (token) next(token);
  };

  const handlePrev = async () => {
    const token = await getValidAccessToken();
    if (token) previous(token);
  };

  return (
    <div className="flex items-center justify-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", shuffle && "bg-primary/15 text-primary")}
              onClick={toggleShuffle}
            >
              <ShuffleIcon />
            </Button>
          }
        />
        <TooltipContent>Shuffle is {shuffle ? "on" : "off"}</TooltipContent>
      </Tooltip>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Previous track"
        onClick={handlePrev}
      >
        <PrevIcon />
      </Button>

      <Button
        variant="default"
        size="icon"
        className="h-10 w-10 rounded-full"
        aria-label={isLoading ? "Loading" : isPlaying ? "Pause" : "Play"}
        onClick={togglePlay}
        disabled={!currentTrack || isLoading}
      >
        {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Next track"
        onClick={handleNext}
      >
        <NextIcon />
      </Button>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", repeat !== "off" && "bg-primary/15 text-primary")}
              onClick={cycleRepeat}
            >
              {repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
            </Button>
          }
        />
        <TooltipContent>
          {repeat === "off" ? "Repeat is off" : repeat === "one" ? "Repeat one track" : "Repeat all"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function ShuffleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function RepeatOneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <text x="12" y="15" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">1</text>
    </svg>
  );
}
