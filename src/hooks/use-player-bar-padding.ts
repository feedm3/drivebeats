import { usePlayerStore } from "@/stores/player-store";

export function usePlayerBarPadding(): string {
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  return hasTrack ? "pb-32 md:pb-36" : "pb-6";
}
