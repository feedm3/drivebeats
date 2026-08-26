import { usePlayerStore } from "@/stores/player-store";

export function usePlayerBarPadding(): string {
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  return hasTrack
    ? "pb-[calc(var(--player-bar-height,10rem)+1rem)] standalone:pb-[calc(var(--player-bar-height,11rem)+1rem)]"
    : "pb-6";
}
