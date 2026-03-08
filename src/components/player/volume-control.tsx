"use client";

import { usePlayerStore } from "@/stores/player-store";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

export function VolumeControl() {
  const { volume, isMuted, setVolume, toggleMute } = usePlayerStore();

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
        onClick={toggleMute}
      >
        {isMuted || volume === 0 ? <MuteIcon /> : volume < 0.5 ? <VolLowIcon /> : <VolHighIcon />}
      </Button>
      <Slider
        aria-label="Volume"
        value={[isMuted ? 0 : volume]}
        max={1}
        step={0.01}
        onValueChange={(v) => setVolume(Array.isArray(v) ? v[0] : v)}
        className="group hidden w-24 sm:flex"
      />
    </div>
  );
}

function MuteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

function VolLowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VolHighIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}
