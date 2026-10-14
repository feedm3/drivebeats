import { usePlayerStore } from "@/stores/player-store";

export function usePlayerBarPadding(): string {
  const hasPlayer = usePlayerStore(
    (s) => s.currentTrack !== null || s.queuedTracks.length > 0,
  );
  return hasPlayer
    ? "pb-[calc(var(--player-bar-height,10rem)+1rem)] standalone:pb-[calc(var(--player-bar-height,11rem)+1rem)]"
    : "pb-6";
}
