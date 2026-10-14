import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCloudPlaylist,
  fetchCloudLibrarySync,
  renameCloudPlaylist,
} from "@/lib/cloud-library-api";
import {
  hasPendingPlaylistMutations,
  usePlaylistStore,
  waitForPendingPlaylistMutations,
} from "@/stores/playlist-store";

vi.mock("@/lib/cloud-library-api", () => ({
  createCloudPlaylist: vi.fn(),
  renameCloudPlaylist: vi.fn(),
  fetchCloudLibrarySync: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

describe("playlist mutation completion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    usePlaylistStore.setState({ playlists: [], isCloudHydrated: true });
  });

  it("serializes writes and releases the pending gate after the last write", async () => {
    const create = Promise.withResolvers<void>();
    const rename = Promise.withResolvers<void>();
    vi.mocked(createCloudPlaylist).mockImplementation(async () => {
      await create.promise;
    });
    vi.mocked(renameCloudPlaylist).mockImplementation(async () => {
      await rename.promise;
    });

    const creating = usePlaylistStore.getState().createPlaylist("First");
    const playlistId = usePlaylistStore.getState().playlists[0].id;
    const renaming = usePlaylistStore
      .getState()
      .renamePlaylist(playlistId, "Second");
    await vi.waitFor(() => expect(createCloudPlaylist).toHaveBeenCalledOnce());
    expect(renameCloudPlaylist).not.toHaveBeenCalled();
    expect(hasPendingPlaylistMutations()).toBe(true);

    create.resolve();
    await creating;
    await vi.waitFor(() => expect(renameCloudPlaylist).toHaveBeenCalledOnce());
    expect(hasPendingPlaylistMutations()).toBe(true);
    rename.resolve();
    await renaming;
    await waitForPendingPlaylistMutations();

    expect(hasPendingPlaylistMutations()).toBe(false);
    expect(usePlaylistStore.getState().playlists[0].name).toBe("Second");
  });

  it("releases the pending gate after a failed write and cloud recovery", async () => {
    vi.mocked(createCloudPlaylist).mockRejectedValue(new Error("offline"));
    vi.mocked(fetchCloudLibrarySync).mockResolvedValue({
      playlists: [],
      favorites: [],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(
        await usePlaylistStore.getState().createPlaylist("Failed"),
      ).toBeNull();
      await waitForPendingPlaylistMutations();
      expect(hasPendingPlaylistMutations()).toBe(false);
      expect(usePlaylistStore.getState().playlists).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});
