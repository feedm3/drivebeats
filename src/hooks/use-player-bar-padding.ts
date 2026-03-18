import { usePlayerStore } from "@/stores/player-store";

export function usePlayerBarPadding(): string {
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  return hasTrack
    ? "pb-32 md:pb-36 standalone:pb-40 standalone:md:pb-44"
    : "pb-6";
}
