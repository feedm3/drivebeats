"use client";

import { Slider } from "@/components/ui/slider";
import { usePlayerStore } from "@/stores/player-store";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);

  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-left tabular-nums text-xs text-muted-foreground">
        {formatTime(currentTime)}
      </span>
      <Slider
        value={[currentTime]}
        max={duration || 100}
        step={0.1}
        onValueChange={(v) => seek(Array.isArray(v) ? v[0] : v)}
        className="group flex-1"
      />
      <span className="w-10 text-right tabular-nums text-xs text-muted-foreground">
        {formatTime(duration)}
      </span>
    </div>
  );
}
