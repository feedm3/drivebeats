import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      playbackCursor: 0,
      playbackSequence: [
        { entryId: "current", track: current, folderStack: [], sourceIndex: 0 },
        {
          entryId: "first",
          track: addition,
          folderStack: [],
          sourceIndex: null,
        },
        {
          entryId: "second",
          track: addition,
          folderStack: [],
          sourceIndex: null,
        },
        {
          entryId: "source",
          track: continuation,
          folderStack: [],
          sourceIndex: 1,
        },
      ],
      queuedTracks: [
        { entryId: "first", track: addition, folderStack: [] },
        { entryId: "second", track: addition, folderStack: [] },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePlayerStore.setState(initialState, true);
  });

  it("removes one repeated addition, then clears remaining additions while keeping playback and collection continuation", async () => {
    render(<PlaybackQueuePopover />);
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
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
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue" })).toBeInTheDocument();
  });

  it("retains row identity and browsing scroll as playback advances", async () => {
    render(<PlaybackQueuePopover />);
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    const currentButton = await screen.findByRole("button", {
      name: "Play Current.mp3, current track",
    });
    const currentRow = currentButton.closest("li");
    const scroll = currentRow?.closest("[data-queue-scroll]") as HTMLDivElement;
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    scroll.scrollTop = 125;

    act(() =>
      usePlayerStore.setState({ playbackCursor: 1, currentTrack: addition }),
    );
    expect(
      screen
        .getByRole("button", { name: "Play Current.mp3, played" })
        .closest("li"),
    ).toBe(currentRow);
    expect(currentRow).toHaveAttribute("data-status", "played");
    expect(scroll.scrollTop).toBe(125);
    expect(screen.getAllByText("Added")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Play Added.mp3, current track" }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("renders and reveals the current entry beyond the first page when opened", async () => {
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.queueEntry === "long-120")
          return new DOMRect(0, 6720, 384, 56);
        return originalBounds.call(this);
      },
    );
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
      function (this: Element) {
        return this.hasAttribute("data-queue-scroll") ? 200 : 0;
      },
    );
    const playbackSequence = Array.from({ length: 150 }, (_, index) => ({
      entryId: `long-${index}`,
      track: {
        id: `track-${index}`,
        name: `Track ${index}.mp3`,
        mimeType: "audio/mpeg",
      },
      folderStack: [],
      sourceIndex: index,
    }));
    usePlayerStore.setState({ playbackSequence, playbackCursor: 120 });
    render(<PlaybackQueuePopover />);
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    const currentButton = await screen.findByRole("button", {
      name: "Play Track 120.mp3, current track",
    });
    const row = currentButton.closest("li") as HTMLLIElement;
    const scroll = row.closest("[data-queue-scroll]") as HTMLDivElement;
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(scroll.scrollTop).toBe(6648);
    expect(
      screen.getByRole("button", { name: "Show more tracks" }),
    ).toBeInTheDocument();
  });

  it("dismisses with Escape and restores focus without changing the queue", async () => {
    render(<PlaybackQueuePopover />);
    const trigger = screen.getByRole("button", {
      name: "Queue",
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
