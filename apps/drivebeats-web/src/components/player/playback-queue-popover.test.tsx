import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import { PlaybackQueuePopover } from "./playback-queue-popover";

const initialState = usePlayerStore.getState();
const current = { id: "current", name: "Current.mp3", mimeType: "audio/mpeg" };
const continuation = {
  id: "source",
  name: "Collection.mp3",
  mimeType: "audio/mpeg",
};
const addition = { id: "addition", name: "Added.mp3", mimeType: "audio/mpeg" };

describe("Playback Queue popover", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      ...initialState,
      currentTrack: current,
      currentIndex: 0,
      playlist: [current, continuation],
      shuffle: false,
      repeat: "off",
      queuedPlaybackContext: null,
      queuedTracks: [
        { entryId: "first", track: addition, folderStack: [] },
        { entryId: "second", track: addition, folderStack: [] },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    usePlayerStore.setState(initialState, true);
  });

  it("removes one repeated addition, then clears remaining additions while keeping playback and collection continuation", async () => {
    render(<PlaybackQueuePopover />);
    fireEvent.click(
      screen.getByRole("button", { name: "Queue, 3 upcoming tracks" }),
    );
    const removals = await screen.findAllByRole("button", {
      name: "Remove Added.mp3 from queue",
    });
    fireEvent.click(removals[0]);
    expect(
      usePlayerStore.getState().queuedTracks.map((entry) => entry.entryId),
    ).toEqual(["second"]);
    expect(
      screen.getByRole("button", { name: "Remove Added.mp3 from queue" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear additions" }));
    expect(usePlayerStore.getState().queuedTracks).toEqual([]);
    expect(usePlayerStore.getState().currentTrack).toEqual(current);
    expect(usePlayerStore.getState().playlist).toEqual([current, continuation]);
    expect(
      screen.queryByRole("button", { name: "Clear additions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Queue, 1 upcoming track" }),
    ).toBeInTheDocument();
  });

  it("dismisses with Escape and restores focus without changing the queue", async () => {
    render(<PlaybackQueuePopover />);
    const trigger = screen.getByRole("button", {
      name: "Queue, 3 upcoming tracks",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const closeButton = await screen.findByRole("button", {
      name: "Close queue",
    });
    fireEvent.keyDown(closeButton, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Close queue" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      usePlayerStore.getState().queuedTracks.map((entry) => entry.entryId),
    ).toEqual(["first", "second"]);
  });
});
