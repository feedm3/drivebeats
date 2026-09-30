import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import { PlayControls } from "./play-controls";

const initialState = usePlayerStore.getState();
const tracks = ["a", "b", "c"].map((id) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
}));

describe("shuffle next control", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: tracks[0],
      currentIndex: 0,
      playlist: tracks,
      shuffle: true,
      repeat: "off",
      shuffleCycle: { remainingIds: ["b", "c"], playedIds: ["a"] },
    });
  });

  afterEach(() => {
    cleanup();
    usePlayerStore.setState(initialState, true);
  });

  it("updates Next when a cycle exhausts or gains a track without changing the current index", () => {
    render(<PlayControls />);
    const nextButton = screen.getByRole("button", { name: "Next track" });
    expect(nextButton).toBeEnabled();

    act(() => {
      usePlayerStore.setState({
        shuffleCycle: { remainingIds: [], playedIds: ["a", "b", "c"] },
      });
    });
    expect(nextButton).toBeDisabled();

    act(() => {
      usePlayerStore.setState({
        playlist: [
          ...tracks,
          { id: "d", name: "d.mp3", mimeType: "audio/mpeg" },
        ],
        shuffleCycle: { remainingIds: ["d"], playedIds: ["a", "b", "c"] },
      });
    });
    expect(nextButton).toBeEnabled();
  });

  it("allows a fresh cycle with Repeat all after every track has been consumed", () => {
    usePlayerStore.setState({
      shuffleCycle: { remainingIds: [], playedIds: ["a", "b", "c"] },
    });
    render(<PlayControls />);
    const nextButton = screen.getByRole("button", { name: "Next track" });
    expect(nextButton).toBeDisabled();

    act(() => usePlayerStore.setState({ repeat: "all" }));
    expect(nextButton).toBeEnabled();
  });
});
