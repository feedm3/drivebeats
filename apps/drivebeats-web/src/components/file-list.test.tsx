import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileList } from "@/components/file-list";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/hooks/use-cached-track-tags", () => ({
  useCachedTrackTags: () => ({
    title: "Next",
    artist: "Artist",
    album: "Album",
  }),
}));
vi.mock("@/hooks/use-cached-track-search", () => ({
  useCachedTrackSearch: (
    files: DriveFile[],
    query: string,
    enabled: boolean,
  ) => ({
    tracks: enabled ? files.filter((file) => file.name.includes(query)) : files,
    pending: false,
  }),
}));
vi.mock("@/hooks/use-player-bar-padding", () => ({
  usePlayerBarPadding: () => "",
}));
vi.mock("@/lib/metadata-index-coordinator", () => ({
  observeVisibleMetadataTrack: vi.fn(),
  setCurrentMetadataFolder: vi.fn(),
}));
const current: DriveFile = {
  id: "current",
  name: "Current.mp3",
  mimeType: "audio/mpeg",
};
const track: DriveFile = {
  id: "next",
  name: "Next.mp3",
  mimeType: "audio/mpeg",
};
const initialPlayer = usePlayerStore.getState();
const playTrack = vi.fn();
const folderStack = [{ id: "album", name: "Album" }];

function renderTrack() {
  return render(
    <FileList
      files={[track]}
      loading={false}
      folderStack={[]}
      folderStackById={new Map([[track.id, folderStack]])}
      searchQuery=""
      onClearSearch={vi.fn()}
      onFolderClick={vi.fn()}
    />,
  );
}

beforeEach(() => {
  playTrack.mockClear();
  usePlayerStore.setState({
    ...initialPlayer,
    currentTrack: current,
    playlist: [current],
    currentIndex: 0,
    queuedTracks: [],
    playTrack,
  });
});
afterEach(() => {
  cleanup();
  usePlayerStore.setState(initialPlayer);
});

describe("Library row options", () => {
  it.each(["Play next", "Add to queue"])(
    "%s keeps playback unchanged and retains the track's containing folder",
    async (action) => {
      renderTrack();
      const trigger = screen.getByRole("button", {
        name: "More options for Next.mp3",
      });
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole("button", { name: action }));
      expect(playTrack).not.toHaveBeenCalled();
      expect(usePlayerStore.getState()).toMatchObject({
        currentTrack: current,
        queuedTracks: [{ track, folderStack }],
      });
    },
  );

  it("keeps descendant keyboard events from playing a track while allowing row activation", () => {
    renderTrack();
    const row = screen.getByRole("button", { name: "Play Next.mp3" });
    const favorite = within(row).getByRole("button", {
      name: "Add Next.mp3 to favorites",
    });
    fireEvent.keyDown(favorite, { key: "Enter" });
    fireEvent.keyDown(favorite, { key: " " });
    expect(playTrack).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(playTrack).toHaveBeenCalledOnce();
    expect(playTrack.mock.calls[0][0]).toEqual(track);
  });

  it("reveals and hides details from the menu with an accessible disclosure state", async () => {
    renderTrack();
    const menu = screen.getByRole("button", {
      name: "More options for Next.mp3",
    });
    fireEvent.click(menu);
    expect(
      await screen.findByRole("button", { name: "Add to playlist: Next.mp3" }),
    ).toHaveTextContent("Add to playlist");
    const showDetails = screen.getByRole("button", {
      name: "Track details",
      expanded: false,
    });
    fireEvent.click(showDetails);
    fireEvent.click(menu);
    const hideDetails = await screen.findByRole("button", {
      name: "Hide track details",
      expanded: true,
    });
    const detailsId = hideDetails.getAttribute("aria-controls");
    const details = document.getElementById(detailsId ?? "");
    expect(details).toHaveTextContent("Album");
    expect(details).toHaveTextContent("Next.mp3");
    fireEvent.click(hideDetails);
    expect(document.getElementById(detailsId ?? "")).toBeNull();
    expect(playTrack).not.toHaveBeenCalled();
  });
});

describe("FileList incremental rendering", () => {
  const tracks: DriveFile[] = Array.from({ length: 300 }, (_, index) => ({
    id: `track-${index}`,
    name: `Track ${String(index).padStart(3, "0")}.mp3`,
    mimeType: "audio/mpeg",
  }));
  let intersect: () => void;

  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = () =>
            callback(
              [{ isIntersecting: true }] as IntersectionObserverEntry[],
              this as unknown as IntersectionObserver,
            );
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderTracks(query = "") {
    return (
      <FileList
        files={tracks}
        loading={false}
        folderStack={folderStack}
        searchQuery={query}
        onClearSearch={vi.fn()}
        onFolderClick={vi.fn()}
      />
    );
  }

  it("limits the first render while retaining the full playback collection and scroll access", () => {
    render(renderTracks());
    const initialRows = screen.getAllByRole("button", { name: /^Play Track / });
    // Enough rows for scrolling, without mounting hundreds before first paint.
    expect(initialRows.length).toBeGreaterThan(10);
    expect(initialRows.length).toBeLessThanOrEqual(50);
    expect(
      screen.queryByRole("button", { name: "Play Track 299.mp3" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play Track 000.mp3" }));
    expect(playTrack.mock.calls[0][1]).toEqual(tracks);

    act(() => intersect());
    expect(
      screen.getByRole("button", { name: "Play Track 200.mp3" }),
    ).toBeInTheDocument();
    act(() => intersect());
    expect(
      screen.getByRole("button", { name: "Play Track 299.mp3" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Showing .* items/)).not.toBeInTheDocument();
  });

  it("finds tracks outside the rendered rows when searching the Current Folder", () => {
    const { rerender } = render(renderTracks());
    expect(
      screen.queryByRole("button", { name: "Play Track 299.mp3" }),
    ).not.toBeInTheDocument();

    rerender(renderTracks("Track 299"));

    expect(
      screen.getByRole("button", { name: "Play Track 299.mp3" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Play Track 000.mp3" }),
    ).not.toBeInTheDocument();
  });
});
