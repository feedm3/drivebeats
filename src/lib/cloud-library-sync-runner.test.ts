import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudLibrarySyncPayload } from "@/lib/cloud-library-shared";
import type { Playlist, PlaylistTrack } from "@/types";

const CLOUD_BOOTSTRAP_KEY = "drivebeats-cloud-bootstrap-v1";

const mockFetchCloudLibrarySync = vi.fn();
const mockBootstrapCloudLibrarySync = vi.fn();
vi.mock("@/lib/cloud-library-api", () => ({
  fetchCloudLibrarySync: () => mockFetchCloudLibrarySync(),
  bootstrapCloudLibrarySync: (data: unknown) =>
    mockBootstrapCloudLibrarySync(data),
  createCloudLibrarySnapshot: (
    playlists: Playlist[],
    favorites: PlaylistTrack[],
    trackMetadata?: unknown,
  ) => ({ playlists, favorites, trackMetadata }),
  isCloudLibraryEmpty: (data: CloudLibrarySyncPayload) =>
    data.playlists.length === 0 && data.favorites.length === 0,
}));

const mockReplacePlaylistsFromCloud = vi.fn();
const playlistState = {
  playlists: [] as Playlist[],
  isCloudHydrated: true,
  replacePlaylistsFromCloud: mockReplacePlaylistsFromCloud,
};
let pendingPlaylistMutations = false;
vi.mock("@/stores/playlist-store", () => ({
  usePlaylistStore: { getState: () => playlistState },
  hasPendingPlaylistMutations: () => pendingPlaylistMutations,
  waitForPendingPlaylistMutations: async () => undefined,
}));

interface TestLibraryTrack extends PlaylistTrack {
  isFavorite?: boolean;
}

const mockReplaceFavoritesFromCloud = vi.fn();
const libraryState = {
  tracks: {} as Record<string, TestLibraryTrack>,
  isCloudHydrated: true,
  replaceFavoritesFromCloud: mockReplaceFavoritesFromCloud,
};
let pendingFavoriteMutations = false;
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: { getState: () => libraryState },
  getFavoriteTracks: (tracks: Record<string, TestLibraryTrack>) =>
    Object.values(tracks)
      .filter((track) => track.isFavorite)
      .map(({ isFavorite: _isFavorite, ...track }) => track),
  hasPendingFavoriteMutations: () => pendingFavoriteMutations,
  waitForPendingFavoriteMutations: async () => undefined,
}));

const authState = {
  authStatus: "authenticated" as
    | "unknown"
    | "authenticated"
    | "unauthenticated",
  user: null as { id: string } | null,
};
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => authState },
}));

const mockHydrateFromSync = vi.fn();
const id3State = {
  cache: {} as Record<string, { modifiedTime?: string; title?: string }>,
  hydrateFromSync: mockHydrateFromSync,
};
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: { getState: () => id3State },
}));

async function loadRunner() {
  vi.resetModules();
  return import("@/lib/cloud-library-sync-runner");
}

function track(overrides: Partial<PlaylistTrack> = {}): PlaylistTrack {
  return {
    fileId: "file-1",
    fileName: "Song.mp3",
    mimeType: "audio/mpeg",
    size: "1000",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    parentFolderName: "Album",
    ...overrides,
  };
}

function payload(
  overrides: Partial<CloudLibrarySyncPayload> = {},
): CloudLibrarySyncPayload {
  return { playlists: [], favorites: [], ...overrides };
}

/**
 * Lets a started sync reach its `fetchCloudLibrarySync()` call, which sits
 * behind the await on the pending local mutations.
 */
async function flushSyncStart() {
  await vi.advanceTimersByTimeAsync(0);
}

/** A fetch the test resolves by hand, so callers can arrive mid-flight. */
function deferredFetch() {
  let resolve!: (value: CloudLibrarySyncPayload) => void;
  const promise = new Promise<CloudLibrarySyncPayload>((res) => {
    resolve = res;
  });
  mockFetchCloudLibrarySync.mockReturnValue(promise);
  return { resolve };
}

describe("runCloudLibrarySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));

    playlistState.playlists = [];
    playlistState.isCloudHydrated = true;
    libraryState.tracks = {};
    libraryState.isCloudHydrated = true;
    id3State.cache = {};
    pendingPlaylistMutations = false;
    pendingFavoriteMutations = false;
    authState.authStatus = "authenticated";
    authState.user = { id: "user-1" };

    window.localStorage.setItem(CLOUD_BOOTSTRAP_KEY, "1");
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });

    mockFetchCloudLibrarySync.mockResolvedValue(payload());
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("skips a sync that happens inside the throttle window", async () => {
    const { runCloudLibrarySync } = await loadRunner();

    await runCloudLibrarySync();
    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    await runCloudLibrarySync();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);
  });

  it("does not queue a skipped sync for later", async () => {
    const { runCloudLibrarySync, CLOUD_SYNC_MIN_INTERVAL_MS } =
      await loadRunner();

    await runCloudLibrarySync();
    await runCloudLibrarySync();

    // Draining timers must not release a deferred sync.
    await vi.advanceTimersByTimeAsync(CLOUD_SYNC_MIN_INTERVAL_MS * 2);

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);
  });

  it("runs again once the throttle window has elapsed", async () => {
    const { runCloudLibrarySync, CLOUD_SYNC_MIN_INTERVAL_MS } =
      await loadRunner();

    await runCloudLibrarySync();
    vi.advanceTimersByTime(CLOUD_SYNC_MIN_INTERVAL_MS);
    await runCloudLibrarySync();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(2);
  });

  it("lets a forced sync bypass the throttle window", async () => {
    const { runCloudLibrarySync } = await loadRunner();

    await runCloudLibrarySync();
    vi.advanceTimersByTime(1_000);
    await runCloudLibrarySync({ force: true });

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(2);
  });

  it("keeps the single-flight guard: overlapping calls share one fetch", async () => {
    const { runCloudLibrarySync } = await loadRunner();
    const { resolve } = deferredFetch();

    const first = runCloudLibrarySync({ force: true });
    const second = runCloudLibrarySync({ force: true });
    await flushSyncStart();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);

    resolve(payload({ favorites: [track()] }));
    await Promise.all([first, second]);

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);
    // One shared fetch, and the payload was still applied for the callers.
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(2);
  });

  it("hydrates the stores for a caller that mounted while a sync was in flight", async () => {
    const { runCloudLibrarySync } = await loadRunner();
    const { resolve } = deferredFetch();

    // First mount starts the forced sync, then unmounts before it resolves.
    let unmounted = false;
    const first = runCloudLibrarySync({
      force: true,
      isCancelled: () => unmounted,
    });
    unmounted = true;

    // The remount issues its own forced sync and adopts the running fetch.
    const second = runCloudLibrarySync({
      force: true,
      isCancelled: () => false,
    });

    resolve(
      payload({
        favorites: [track()],
        playlists: [{ id: "p1", name: "Road trip", tracks: [] }],
      }),
    );
    await Promise.all([first, second]);

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);
    // The unmounted caller does not apply, the live one does.
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
    expect(mockReplacePlaylistsFromCloud).toHaveBeenCalledTimes(1);
  });

  it("does not apply a payload once the session ended mid-flight", async () => {
    const { runCloudLibrarySync } = await loadRunner();
    const { resolve } = deferredFetch();

    const run = runCloudLibrarySync({
      force: true,
      // Still "live": only the session changed, not this caller.
      isCancelled: () => false,
    });

    authState.authStatus = "unauthenticated";
    authState.user = null;

    resolve(payload({ favorites: [track()] }));
    await run;

    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
    expect(mockReplacePlaylistsFromCloud).not.toHaveBeenCalled();
  });

  it("does not hand another account's caller the running sync", async () => {
    const { runCloudLibrarySync } = await loadRunner();
    const { resolve } = deferredFetch();

    let unmounted = false;
    const first = runCloudLibrarySync({
      force: true,
      isCancelled: () => unmounted,
    });
    await flushSyncStart();
    unmounted = true;

    // A different user signs in and mounts a fresh sync component.
    authState.user = { id: "user-2" };
    const secondFetch = deferredFetch();
    const second = runCloudLibrarySync({
      force: true,
      isCancelled: () => false,
    });
    await flushSyncStart();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(2);

    resolve(payload({ favorites: [track({ fileId: "user-1-track" })] }));
    secondFetch.resolve(
      payload({ favorites: [track({ fileId: "user-2-track" })] }),
    );
    await Promise.all([first, second]);

    // Only the second user's payload reached the stores.
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledWith([
      track({ fileId: "user-2-track" }),
    ]);
  });

  it("reopens the throttle window after a sync that failed", async () => {
    const { runCloudLibrarySync } = await loadRunner();

    mockFetchCloudLibrarySync.mockResolvedValue(
      payload({ favorites: [track()] }),
    );
    mockFetchCloudLibrarySync.mockRejectedValueOnce(new Error("offline blip"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await runCloudLibrarySync();
    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);

    // Well inside the throttle window, but nothing was applied, so the next
    // resume must be allowed to retry.
    vi.advanceTimersByTime(1_000);
    await runCloudLibrarySync();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(2);
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("reopens the throttle window after a sync blocked by pending mutations", async () => {
    pendingPlaylistMutations = true;
    const { runCloudLibrarySync } = await loadRunner();
    mockFetchCloudLibrarySync.mockResolvedValue(
      payload({ favorites: [track()] }),
    );

    await runCloudLibrarySync();
    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(3);

    pendingPlaylistMutations = false;
    vi.advanceTimersByTime(1_000);
    await runCloudLibrarySync();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(4);
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
  });

  it("keeps the throttle window closed after a sync that applied", async () => {
    const { runCloudLibrarySync } = await loadRunner();
    mockFetchCloudLibrarySync.mockResolvedValue(
      payload({ favorites: [track()] }),
    );

    await runCloudLibrarySync();
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await runCloudLibrarySync();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);
  });

  it("does not open the throttle window while offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    const { runCloudLibrarySync } = await loadRunner();
    await runCloudLibrarySync();
    expect(mockFetchCloudLibrarySync).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
    await runCloudLibrarySync();

    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(1);
  });

  it("skips applying the payload when the caller was cancelled", async () => {
    const { runCloudLibrarySync } = await loadRunner();

    mockFetchCloudLibrarySync.mockResolvedValue(
      payload({ favorites: [track()] }),
    );

    await runCloudLibrarySync({ isCancelled: () => true });

    expect(mockReplacePlaylistsFromCloud).not.toHaveBeenCalled();
    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
  });

  it("does not apply a payload while local mutations are still pending", async () => {
    pendingPlaylistMutations = true;
    const { runCloudLibrarySync } = await loadRunner();

    mockFetchCloudLibrarySync.mockResolvedValue(
      payload({ favorites: [track()] }),
    );

    await runCloudLibrarySync({ force: true });

    // Three attempts, because the local queue never drains.
    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(3);
    expect(mockReplacePlaylistsFromCloud).not.toHaveBeenCalled();
    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
  });

  it("bootstraps local data into an empty cloud on first run", async () => {
    window.localStorage.removeItem(CLOUD_BOOTSTRAP_KEY);
    playlistState.playlists = [
      { id: "p1", name: "Road trip", tracks: [track()] },
    ];
    id3State.cache = { "file-1": { title: "Song" } };

    const { runCloudLibrarySync } = await loadRunner();
    await runCloudLibrarySync({ force: true });

    expect(mockBootstrapCloudLibrarySync).toHaveBeenCalledTimes(1);
    expect(mockBootstrapCloudLibrarySync).toHaveBeenCalledWith({
      playlists: playlistState.playlists,
      favorites: [],
      trackMetadata: { "file-1": { title: "Song" } },
    });
    // Fetched once before and once after the bootstrap upload.
    expect(mockFetchCloudLibrarySync).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(CLOUD_BOOTSTRAP_KEY)).toBe("1");
  });

  it("does not bootstrap again once the cloud has been seeded", async () => {
    playlistState.playlists = [
      { id: "p1", name: "Road trip", tracks: [track()] },
    ];

    const { runCloudLibrarySync } = await loadRunner();
    await runCloudLibrarySync({ force: true });

    expect(mockBootstrapCloudLibrarySync).not.toHaveBeenCalled();
  });
});

describe("applyCloudLibraryPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playlistState.playlists = [];
    playlistState.isCloudHydrated = true;
    libraryState.tracks = {};
    libraryState.isCloudHydrated = true;
    id3State.cache = {};
  });

  it("does not replace stores when the payload matches the current state", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    const playlist: Playlist = {
      id: "p1",
      name: "Road trip",
      tracks: [track({ fileId: "a" }), track({ fileId: "b" })],
    };
    playlistState.playlists = [playlist];
    libraryState.tracks = {
      f1: { ...track({ fileId: "f1" }), isFavorite: true },
      f2: { ...track({ fileId: "f2" }), isFavorite: true },
    };
    id3State.cache = { a: { title: "Song", modifiedTime: "2026-01-01" } };

    applyCloudLibraryPayload({
      // Structurally equal but freshly allocated, and favorites arrive in a
      // different order than the store keeps them in.
      playlists: [
        {
          id: "p1",
          name: "Road trip",
          tracks: [track({ fileId: "a" }), track({ fileId: "b" })],
        },
      ],
      favorites: [track({ fileId: "f2" }), track({ fileId: "f1" })],
      trackMetadata: { a: { title: "Song", modifiedTime: "2026-01-01" } },
    });

    expect(mockReplacePlaylistsFromCloud).not.toHaveBeenCalled();
    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
    expect(mockHydrateFromSync).not.toHaveBeenCalled();
  });

  it("ignores optional favorite fields the cloud omits but the store already knows", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    libraryState.tracks = {
      f1: { ...track({ fileId: "f1" }), isFavorite: true },
    };

    applyCloudLibraryPayload(
      payload({
        favorites: [{ fileId: "f1", fileName: "Song.mp3" }],
      }),
    );

    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
  });

  it("replaces playlists when a track order changed", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    playlistState.playlists = [
      {
        id: "p1",
        name: "Road trip",
        tracks: [track({ fileId: "a" }), track({ fileId: "b" })],
      },
    ];

    applyCloudLibraryPayload(
      payload({
        playlists: [
          {
            id: "p1",
            name: "Road trip",
            tracks: [track({ fileId: "b" }), track({ fileId: "a" })],
          },
        ],
      }),
    );

    expect(mockReplacePlaylistsFromCloud).toHaveBeenCalledTimes(1);
  });

  it("replaces playlists when a track moved to another Drive folder", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    playlistState.playlists = [
      {
        id: "p1",
        name: "Road trip",
        tracks: [track({ fileId: "a", parents: ["folder-a"] })],
      },
    ];

    applyCloudLibraryPayload(
      payload({
        playlists: [
          {
            id: "p1",
            name: "Road trip",
            tracks: [track({ fileId: "a", parents: ["folder-b"] })],
          },
        ],
      }),
    );

    expect(mockReplacePlaylistsFromCloud).toHaveBeenCalledTimes(1);
  });

  it("replaces favorites when a track moved to another Drive folder", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    libraryState.tracks = {
      f1: {
        ...track({ fileId: "f1", parents: ["folder-a"] }),
        isFavorite: true,
      },
    };

    applyCloudLibraryPayload(
      payload({
        favorites: [track({ fileId: "f1", parents: ["folder-b"] })],
      }),
    );

    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
  });

  it("keeps the favorite parents the store knows when the payload omits them", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    libraryState.tracks = {
      f1: {
        ...track({ fileId: "f1", parents: ["folder-a"] }),
        isFavorite: true,
      },
    };

    // `toLibraryMeta` falls back to the known parents, so this payload would
    // not change the store.
    applyCloudLibraryPayload(
      payload({ favorites: [track({ fileId: "f1", parents: undefined })] }),
    );

    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
  });

  it("ignores the cloud normalizing an unknown parents list to an empty one", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    playlistState.playlists = [
      {
        id: "p1",
        name: "Road trip",
        tracks: [track({ fileId: "a", parents: undefined })],
      },
    ];
    libraryState.tracks = {
      f1: { ...track({ fileId: "f1", parents: undefined }), isFavorite: true },
    };

    applyCloudLibraryPayload(
      payload({
        playlists: [
          {
            id: "p1",
            name: "Road trip",
            tracks: [track({ fileId: "a", parents: [] })],
          },
        ],
        favorites: [track({ fileId: "f1", parents: [] })],
      }),
    );

    expect(mockReplacePlaylistsFromCloud).not.toHaveBeenCalled();
    expect(mockReplaceFavoritesFromCloud).not.toHaveBeenCalled();
  });

  it("replaces playlists when a playlist was renamed", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    playlistState.playlists = [{ id: "p1", name: "Road trip", tracks: [] }];

    applyCloudLibraryPayload(
      payload({ playlists: [{ id: "p1", name: "Roadtrip", tracks: [] }] }),
    );

    expect(mockReplacePlaylistsFromCloud).toHaveBeenCalledTimes(1);
  });

  it("replaces favorites when another device added one", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    libraryState.tracks = {
      f1: { ...track({ fileId: "f1" }), isFavorite: true },
    };

    applyCloudLibraryPayload(
      payload({
        favorites: [track({ fileId: "f1" }), track({ fileId: "f2" })],
      }),
    );

    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
  });

  it("replaces favorites when another device removed the last one", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    libraryState.tracks = {
      f1: { ...track({ fileId: "f1" }), isFavorite: true },
    };

    applyCloudLibraryPayload(payload());

    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledTimes(1);
  });

  it("always replaces while the stores are not cloud hydrated yet", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    playlistState.isCloudHydrated = false;
    libraryState.isCloudHydrated = false;

    applyCloudLibraryPayload(payload());

    expect(mockReplacePlaylistsFromCloud).toHaveBeenCalledWith([]);
    expect(mockReplaceFavoritesFromCloud).toHaveBeenCalledWith([]);
  });

  it("hydrates id3 metadata only for new or newer entries", async () => {
    const { applyCloudLibraryPayload } = await loadRunner();

    id3State.cache = { a: { title: "Song", modifiedTime: "2026-01-01" } };

    applyCloudLibraryPayload(
      payload({
        trackMetadata: { a: { title: "Song", modifiedTime: "2026-02-01" } },
      }),
    );

    expect(mockHydrateFromSync).toHaveBeenCalledTimes(1);
  });
});
