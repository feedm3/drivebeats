import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { PlayerOptionsPopover } from "./player-options-popover";

const initialPlayer = usePlayerStore.getState();
const initialLibrary = useLibraryStore.getState();
const favorite = vi.fn().mockResolvedValue(undefined);
const track = {
  id: "current",
  name: "Current.mp3",
  mimeType: "audio/mpeg",
  size: "1048576",
  parentFolderName: "Album",
};

beforeEach(() => {
  vi.clearAllMocks();
  const audio = document.createElement("audio");
  audio.volume = 0.6;
  usePlayerStore.setState({
    ...initialPlayer,
    audio,
    volume: 0.6,
    isMuted: false,
    currentTrack: track,
    currentTime: 25,
    isPlaying: true,
  });
  useLibraryStore.setState({
    ...initialLibrary,
    tracks: {},
    toggleFavorite: favorite,
  });
});
afterEach(() => {
  cleanup();
  usePlayerStore.setState(initialPlayer);
  useLibraryStore.setState(initialLibrary);
  vi.restoreAllMocks();
});

async function openOptions() {
  render(<PlayerOptionsPopover track={track} />);
  fireEvent.click(screen.getByRole("button", { name: "Player options" }));
  await screen.findByRole("button", { name: "Mute" });
}

describe("mobile player options", () => {
  it("saves the current track descriptor from the menu without affecting playback", async () => {
    await openOptions();
    expect(
      screen.getByRole("button", { name: "Add to playlist: Current.mp3" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    expect(favorite).toHaveBeenCalledWith({
      fileId: track.id,
      fileName: track.name,
      mimeType: track.mimeType,
      size: track.size,
      parentFolderName: "Album",
    });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      currentTime: 25,
      isPlaying: true,
    });
  });

  it("keeps volume controls available while muting and isolates their keyboard events", async () => {
    await openOptions();
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(usePlayerStore.getState().isMuted).toBe(true);
    expect(usePlayerStore.getState().audio?.volume).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(usePlayerStore.getState().audio?.volume).toBe(0.6);
    const shortcuts = vi.fn();
    window.addEventListener("keydown", shortcuts);
    try {
      fireEvent.keyDown(screen.getByRole("slider", { name: "Volume" }), {
        key: "ArrowRight",
      });
      expect(shortcuts).not.toHaveBeenCalled();
      expect(usePlayerStore.getState()).toMatchObject({
        currentTrack: track,
        currentTime: 25,
        isPlaying: true,
      });
    } finally {
      window.removeEventListener("keydown", shortcuts);
    }
  });

  it("dismisses with Escape while returning focus to the menu trigger", async () => {
    await openOptions();
    fireEvent.keyDown(screen.getByRole("button", { name: "Mute" }), {
      key: "Escape",
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Player options" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Player options" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("restores audible volume when unmuting from zero", async () => {
    usePlayerStore.getState().setVolume(0);
    render(<PlayerOptionsPopover track={track} />);
    fireEvent.click(screen.getByRole("button", { name: "Player options" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unmute" }));
    expect(usePlayerStore.getState()).toMatchObject({
      volume: 0.7,
      isMuted: false,
    });
    expect(usePlayerStore.getState().audio?.volume).toBe(0.7);
  });
});
