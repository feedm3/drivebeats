import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaylistTrackItem } from "@/components/playlist-track-item";
import { usePlayerStore } from "@/stores/player-store";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/hooks/use-cached-track-tags", () => ({
  useCachedTrackTags: () => ({
    title: "Title",
    artist: "Artist",
    album: "Album",
  }),
}));

const onPlay = vi.fn();
const onRemove = vi.fn();
const onMoveUp = vi.fn();
const initialPlayer = usePlayerStore.getState();
const track = { fileId: "one", fileName: "One.mp3", size: "1048576" };

function renderRow(isFavorites = false) {
  return render(
    <PlaylistTrackItem
      track={track}
      index={1}
      isActive={false}
      isCurrentlyPlaying={false}
      isPlaying={false}
      isDragging={false}
      dropIndicator={null}
      rowInfo="Yesterday"
      rowInfoLabel="Last played"
      isFavorites={isFavorites}
      onPlay={onPlay}
      onRemove={onRemove}
      onMoveUp={onMoveUp}
      removeLabel={
        isFavorites ? "Remove from favorites" : "Remove from playlist"
      }
    />,
  );
}

async function openMenu() {
  const trigger = screen.getByRole("button", {
    name: "More options for One.mp3",
  });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(trigger);
  return screen.findByRole("button", { name: "Track details" });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ ...initialPlayer, queuedTracks: [] });
});
afterEach(() => {
  cleanup();
  usePlayerStore.setState(initialPlayer);
});

describe("compact collection row actions", () => {
  it("keeps removal in the menu and does not trigger playback", async () => {
    renderRow(true);
    expect(
      screen.queryByRole("button", { name: "Remove from favorites" }),
    ).toBeNull();
    await openMenu();
    expect(
      screen.queryByRole("button", { name: "Add to favorites" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from favorites" }),
    );
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("offers playlist movement through the menu without playing the track", async () => {
    renderRow();
    await openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onPlay).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("queues a track without replacing the current playback", async () => {
    renderRow();
    const currentTrack = usePlayerStore.getState().currentTrack;
    await openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Play next" }));
    expect(usePlayerStore.getState().queuedTracks[0].track.id).toBe("one");
    expect(usePlayerStore.getState().currentTrack).toBe(currentTrack);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("exposes collection information and album in an accessible details disclosure", async () => {
    renderRow();
    const details = await openMenu();
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    fireEvent.click(
      screen.getByRole("button", { name: "More options for One.mp3" }),
    );
    const hide = await screen.findByRole("button", {
      name: "Hide track details",
    });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(
      hide.getAttribute("aria-controls") ?? "",
    );
    expect(panel).toHaveTextContent("Last playedYesterday");
    expect(panel).toHaveTextContent("AlbumAlbum");
    expect(panel).toHaveTextContent("One.mp3");
    fireEvent.click(hide);
    expect(panel).not.toBeInTheDocument();
    expect(onPlay).not.toHaveBeenCalled();
  });
});
