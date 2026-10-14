import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerBarPadding } from "@/hooks/use-player-bar-padding";
import { usePlayerStore } from "@/stores/player-store";

describe("usePlayerBarPadding", () => {
  afterEach(() => {
    act(() => usePlayerStore.getState().resetPlayback());
  });

  it("reserves the measured player height when a track is loaded", () => {
    const { result } = renderHook(() => usePlayerBarPadding());

    act(() => {
      usePlayerStore.setState({
        currentTrack: {
          id: "track",
          name: "Track.mp3",
          mimeType: "audio/mpeg",
        },
      });
    });

    expect(result.current).toContain("var(--player-bar-height");
  });

  it("keeps the last rows reachable while an idle queue opens the player", () => {
    const { result } = renderHook(() => usePlayerBarPadding());

    act(() => {
      usePlayerStore
        .getState()
        .queueTrack(
          { id: "queued", name: "Queued.mp3", mimeType: "audio/mpeg" },
          "end",
        );
    });

    expect(result.current).toContain("var(--player-bar-height");

    act(() => usePlayerStore.getState().clearQueuedTracks());
    expect(result.current).toBe("pb-6");
  });
});
