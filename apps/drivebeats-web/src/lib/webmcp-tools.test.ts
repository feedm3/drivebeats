import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaylistTrack } from "@/lib/audio";
import * as cachedTags from "@/lib/cached-track-tags";
import {
  bootstrapCloudLibrarySync,
  fetchCloudLibrarySync,
} from "@/lib/cloud-library-api";
import { resetCloudLibrarySyncState } from "@/lib/cloud-library-sync-runner";
import * as appDataClient from "@/lib/drive-appdata-client";
import type { LibrarySearchTrack } from "@/lib/library-search-catalog";
import * as metadataCacheDb from "@/lib/metadata-cache-db";
import * as metadataLoader from "@/lib/track-metadata-loader";
import { createDriveBeatsTools } from "@/lib/webmcp-tools";
import { useAuthStore } from "@/stores/auth-store";
import { useDriveAppDataStore } from "@/stores/drive-appdata-store";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { useLibrarySearchStore } from "@/stores/library-search-store";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";

vi.mock("@/lib/cloud-library-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloud-library-api")>()),
  fetchCloudLibrarySync: vi.fn(),
  bootstrapCloudLibrarySync: vi.fn(),
}));
const track: LibrarySearchTrack = {
  id: "imported",
  name: "Needle.mp3",
  mimeType: "audio/mpeg",
  contextLabel: "Imported individually",
  folderStack: [{ id: "root", name: "Library" }],
  importedRootId: null,
  importedRootPaths: [],
  relativePath: "",
};
const initialPlayer = usePlayerStore.getState();
const initialPlaylists = usePlaylistStore.getState();
const initialLibrary = useLibraryStore.getState();
function signIn(userId = "account-a") {
  useAuthStore.setState({
    authStatus: "authenticated",
    isLoggingOut: false,
    accessToken: "never-exposed",
    user: {
      id: userId,
      email: `${userId}@example.test`,
      name: null,
      picture: null,
    },
  });
}
function run(name: string, input: unknown = {}, signal?: AbortSignal) {
  const selected = createDriveBeatsTools().find((tool) => tool.name === name);
  if (!selected) throw new Error(`Missing ${name}`);
  return selected.execute(input, { signal }) as Promise<
    Record<string, unknown>
  >;
}
function audio() {
  return {
    paused: true,
    currentTime: 0,
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  } as unknown as HTMLAudioElement;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  resetCloudLibrarySyncState();
  useDriveAppDataStore.setState({
    accountId: null,
    generation: null,
    status: "idle",
    error: null,
    pendingCount: 0,
    savedCount: 0,
    lastSavedAt: null,
  });
  localStorage.setItem("drivebeats-cloud-bootstrap-v1", "1");
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  vi.mocked(fetchCloudLibrarySync).mockReset();
  vi.mocked(bootstrapCloudLibrarySync).mockReset();
  await useId3MetadataStore.getState().clearAll();
  // A cleared namespace stays sealed against old open-tab authentication.
  // Each test starts a genuinely new sign-in session.
  useAuthStore.getState().clearTokens();
  signIn();
  await useId3MetadataStore.getState().setAccount("account-a");
  useImportedDriveStore.setState({ rootFolders: [], rootFiles: [track] });
  useLibrarySearchStore.setState({
    catalog: {
      userId: "account-a",
      fetchedAt: Date.now(),
      importsSignature: "track:imported",
      tracks: [track],
    },
    invalidated: false,
    failure: null,
    error: null,
    status: "ready",
    ensureReady: vi.fn(async () => true),
  });
  usePlaylistStore.setState({
    ...initialPlaylists,
    playlists: [],
    isCloudHydrated: false,
  });
  useLibraryStore.setState({
    ...initialLibrary,
    tracks: {},
    isCloudHydrated: false,
  });
  usePlayerStore.setState({
    ...initialPlayer,
    audio: audio(),
    currentTrack: null,
    playlist: [],
    volume: 1,
  });
  vi.mocked(fetchCloudLibrarySync).mockResolvedValue({
    playlists: [],
    favorites: [],
  });
});

describe("DriveBeats WebMCP actions", () => {
  it("reads the visible queue with duplicate occurrences and rejects changed pagination without network work", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    usePlayerStore.setState({
      playbackAccountId: "account-a",
      queuedAccountId: "account-a",
      playbackCursor: 1,
      playbackSequence: [
        { entryId: "played", track, sourceIndex: 0, folderStack: [] },
        { entryId: "current", track, sourceIndex: 1, folderStack: [] },
        { entryId: "again", track, sourceIndex: null, folderStack: [] },
      ],
      repeat: "one",
      shuffle: true,
    });
    const first = await run("drivebeats_get_queue", { limit: 2 });
    expect(first).toMatchObject({
      ok: true,
      total: 3,
      currentIndex: 1,
      repeat: "one",
      shuffle: true,
      nextOffset: 2,
      entries: [
        { entryId: "played", status: "played", removable: false },
        { entryId: "current", status: "current", removable: false },
      ],
    });
    expect(
      await run("drivebeats_get_queue", {
        offset: 2,
        revision: first.revision,
      }),
    ).toMatchObject({
      ok: true,
      nextOffset: null,
      entries: [
        {
          entryId: "again",
          status: "upcoming",
          removable: true,
          track: { id: "imported" },
        },
      ],
    });
    usePlayerStore.setState({ playbackCursor: 2 });
    expect(
      await run("drivebeats_get_queue", {
        offset: 2,
        revision: first.revision,
      }),
    ).toMatchObject({ ok: false, error: { code: "queue_changed" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchCloudLibrarySync).not.toHaveBeenCalled();
    expect(useLibrarySearchStore.getState().ensureReady).not.toHaveBeenCalled();
  });
  it("does not expose a restored foreign queue", async () => {
    usePlayerStore.setState({
      playbackAccountId: "other",
      playbackSequence: [
        {
          entryId: "private",
          track: { ...track, id: "foreign", name: "Private.mp3" },
          sourceIndex: 0,
          folderStack: [],
        },
      ],
    });
    const result = await run("drivebeats_get_queue");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "queue_unverified" },
    });
    expect(JSON.stringify(result)).not.toContain("Private.mp3");
  });
  it("separates backup checkpoints from saved metadata and hides raw backup failures", async () => {
    vi.spyOn(appDataClient, "getDriveAppDataLogoutState").mockResolvedValue({
      pendingCount: 0,
      checkpointPending: true,
      incomplete: true,
    });
    useDriveAppDataStore.setState({
      accountId: "account-a",
      generation: "generation",
      status: "ready",
      savedCount: 12,
      lastSavedAt: 123,
    });
    expect(await run("drivebeats_status")).toMatchObject({
      backup: {
        status: "pending",
        complete: false,
        pendingCount: 0,
        checkpointPending: true,
        savedMetadataCount: 12,
        lastSavedAt: 123,
      },
    });
    vi.mocked(appDataClient.getDriveAppDataLogoutState).mockResolvedValue({
      pendingCount: 0,
      checkpointPending: false,
      incomplete: false,
    });
    expect(await run("drivebeats_status")).toMatchObject({
      backup: { status: "saved", complete: true },
    });
    useDriveAppDataStore.setState({
      error: "https://private.test/?token=secret",
    });
    const failed = await run("drivebeats_status");
    expect(failed).toMatchObject({
      backup: {
        status: "error",
        complete: false,
        error: { code: "backup_unavailable" },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("token=secret");
    useDriveAppDataStore.setState({ accountId: "other" });
    expect(await run("drivebeats_status")).toMatchObject({
      backup: { status: "unknown", complete: false },
    });
    expect((await run("drivebeats_status")).backup).not.toHaveProperty(
      "savedMetadataCount",
    );
  });
  it("queues a batch in requested order without interrupting playback or saving a Playlist", async () => {
    const second = { ...track, id: "second", name: "Second.mp3" };
    const catalog = useLibrarySearchStore.getState().catalog;
    if (!catalog) throw new Error("Missing test catalog");
    useLibrarySearchStore.setState({
      catalog: { ...catalog, tracks: [track, second] },
    });
    const playTrack = vi.fn();
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      currentIndex: 0,
      currentTime: 42,
      shuffle: true,
      playTrack,
    });
    usePlayerStore.getState().queueTrack(second, "end");

    expect(
      await run("drivebeats_queue_tracks", {
        trackIds: [track.id, second.id],
        position: "next",
      }),
    ).toMatchObject({
      ok: true,
      queuedTracks: [{ id: track.id }, { id: second.id }, { id: second.id }],
    });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      playlist: [track],
      currentIndex: 0,
      currentTime: 42,
      shuffle: true,
    });
    expect(playTrack).not.toHaveBeenCalled();
    expect(usePlaylistStore.getState().playlists).toEqual([]);
  });

  it("validates every requested queue track before changing the queue", async () => {
    expect(
      await run("drivebeats_queue_tracks", {
        trackIds: [track.id, "outside-library"],
        position: "end",
      }),
    ).toMatchObject({ ok: false, error: { code: "track_not_found" } });
    expect(usePlayerStore.getState().queuedTracks).toEqual([]);
  });

  it("reports a successful skip when the only queued track failed after becoming current", async () => {
    usePlayerStore.getState().queueTrack(track, "end");
    const entry = usePlayerStore.getState().queuedTracks[0];
    usePlayerStore.setState({
      currentTrack: track,
      queuedPlaybackContext: {
        entryId: entry.entryId,
        baseFolderStack: [],
      },
      playbackSequence: [{ ...entry, sourceIndex: null }],
      playbackCursor: 0,
      isPlaying: false,
      lastPlaybackFailure: {
        code: "unsupported_audio",
        message: "This track cannot be played.",
      },
    });

    expect(
      await run("drivebeats_control_playback", { action: "next" }),
    ).toMatchObject({
      ok: true,
      playback: { isPlaying: false, queuedTrackCount: 0 },
    });
    expect(usePlayerStore.getState().playbackSequence).toEqual([
      { ...entry, sourceIndex: null },
    ]);
    expect(usePlayerStore.getState().playbackCursor).toBe(0);
  });

  it("can start a prepared queue through next without a current track", async () => {
    expect(
      await run("drivebeats_queue_tracks", {
        trackIds: [track.id],
        position: "end",
      }),
    ).toMatchObject({
      ok: true,
      playback: { playerOpen: true, isPlaying: false, queueCursor: null },
    });
    const playerAudio = audio();
    Object.defineProperty(playerAudio, "paused", { value: false });
    const next = vi.fn(async () => {
      usePlayerStore.setState({
        currentTrack: track,
        audio: playerAudio,
        isPlaying: true,
      });
    });
    usePlayerStore.setState({ audio: null, next });

    expect(
      await run("drivebeats_control_playback", { action: "next" }),
    ).toMatchObject({ ok: true, playback: { isPlaying: true } });
    expect(next).toHaveBeenCalledOnce();
  });

  it("validates restored explicit queue entries before advancing playback", async () => {
    const next = vi.fn();
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      next,
    });
    usePlayerStore
      .getState()
      .queueTrack({ ...track, id: "outside-library" }, "end");
    expect(
      await run("drivebeats_control_playback", { action: "next" }),
    ).toMatchObject({ ok: false, error: { code: "track_not_found" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("validates retained session history before navigating to a previous track", async () => {
    const previous = vi.fn();
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      playbackSequence: [
        {
          entryId: "old-occurrence",
          track: { ...track, id: "outside-library" },
          folderStack: [],
          sourceIndex: null,
        },
        {
          entryId: "current-occurrence",
          track,
          folderStack: [],
          sourceIndex: 0,
        },
      ],
      playbackCursor: 1,
      previous,
    });
    expect(
      await run("drivebeats_control_playback", { action: "previous" }),
    ).toMatchObject({ ok: false, error: { code: "track_not_found" } });
    expect(previous).not.toHaveBeenCalled();
  });

  it("does not navigate after another control moves the session cursor during validation", async () => {
    const next = vi.fn();
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      playbackSequence: [
        { entryId: "first", track, folderStack: [], sourceIndex: 0 },
        { entryId: "second", track, folderStack: [], sourceIndex: null },
      ],
      playbackCursor: 0,
      next,
    });
    vi.mocked(fetchCloudLibrarySync).mockImplementation(async () => {
      usePlayerStore.setState({ playbackCursor: 1 });
      return { playlists: [], favorites: [] };
    });

    expect(
      await run("drivebeats_control_playback", { action: "next" }),
    ).toMatchObject({ ok: false, error: { code: "player_changed" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("reports the full retained session length and current occurrence", async () => {
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      playbackSequence: [
        { entryId: "first", track, folderStack: [], sourceIndex: 0 },
        { entryId: "second", track, folderStack: [], sourceIndex: null },
        { entryId: "third", track, folderStack: [], sourceIndex: null },
      ],
      playbackCursor: 1,
    });
    expect(await run("drivebeats_status")).toMatchObject({
      ok: true,
      playback: { queueLength: 3, queueCursor: 1 },
    });
  });

  it("rewinds a paused first occurrence without falsely reporting a playback failure", async () => {
    const playerAudio = audio();
    playerAudio.currentTime = 2;
    usePlayerStore.setState({
      audio: playerAudio,
      currentTrack: track,
      playlist: [track],
      currentIndex: 0,
      currentTime: 2,
      playbackSequence: [
        { entryId: "first", track, folderStack: [], sourceIndex: 0 },
      ],
      playbackCursor: 0,
      isPlaying: false,
    });

    expect(
      await run("drivebeats_control_playback", { action: "previous" }),
    ).toMatchObject({
      ok: true,
      playback: { isPlaying: false, positionSeconds: 0, queueCursor: 0 },
    });
  });

  it("does not queue old-account tracks when the account changes during validation", async () => {
    useLibrarySearchStore.setState({
      ensureReady: vi.fn(async () => {
        signIn("account-b");
        return true;
      }),
    });
    expect(
      await run("drivebeats_queue_tracks", {
        trackIds: [track.id],
        position: "end",
      }),
    ).toMatchObject({ ok: false, error: { code: "account_changed" } });
    expect(usePlayerStore.getState().queuedTracks).toEqual([]);
  });

  it("plays verified saved track IDs even when the imported Library catalog cannot refresh", async () => {
    const savedTrack = { ...track, id: "saved-favorite" };
    vi.mocked(fetchCloudLibrarySync).mockResolvedValue({
      playlists: [],
      favorites: [createPlaylistTrack(savedTrack)],
    });
    useLibrarySearchStore.setState({
      catalog: null,
      ensureReady: vi.fn(async () => false),
    });
    const playerAudio = audio();
    const playTrack = vi.fn(async (currentTrack, playlist) => {
      Object.defineProperty(playerAudio, "paused", { value: false });
      usePlayerStore.setState({ currentTrack, playlist, isPlaying: true });
      return true;
    });
    usePlayerStore.setState({ audio: playerAudio, playTrack });

    expect(
      await run("drivebeats_list_collections", {
        collectionId: "system:favorites",
      }),
    ).toMatchObject({ ok: true, tracks: [{ id: savedTrack.id }] });
    expect(
      await run("drivebeats_play", { trackIds: [savedTrack.id] }),
    ).toMatchObject({
      ok: true,
      playback: { isPlaying: true, track: { id: savedTrack.id } },
    });
    expect(playTrack).toHaveBeenCalledOnce();
    usePlayerStore.setState({ duration: 120 });
    expect(
      await run("drivebeats_control_playback", { action: "seek", seconds: 30 }),
    ).toMatchObject({ ok: true, playback: { positionSeconds: 30 } });
    expect(playerAudio.currentTime).toBe(30);
  });

  it("advertises defaulted search and collection arguments as optional inputs", () => {
    for (const name of [
      "drivebeats_search_library",
      "drivebeats_list_collections",
    ]) {
      const tool = createDriveBeatsTools().find((item) => item.name === name);
      expect(tool?.inputSchema.required ?? []).toEqual([]);
    }
  });

  it("does not resurrect stale local playlists when Drive collections are empty", async () => {
    localStorage.removeItem("drivebeats-cloud-bootstrap-v1");
    const localPlaylist = {
      id: "legacy-local",
      name: "Local music",
      tracks: [],
    };
    usePlaylistStore.setState({ playlists: [localPlaylist] });
    vi.mocked(fetchCloudLibrarySync)
      .mockResolvedValueOnce({ playlists: [], favorites: [] })
      .mockResolvedValueOnce({ playlists: [localPlaylist], favorites: [] });
    vi.mocked(bootstrapCloudLibrarySync).mockResolvedValue();

    expect(await run("drivebeats_list_collections")).toMatchObject({
      ok: true,
    });
    expect(bootstrapCloudLibrarySync).not.toHaveBeenCalled();
    expect(usePlaylistStore.getState().playlists).toEqual([]);
  });

  it("reuses a verified cloud read for consecutive player controls", async () => {
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      duration: 100,
    });
    expect(await run("drivebeats_list_collections")).toMatchObject({
      ok: true,
    });
    await run("drivebeats_control_playback", { action: "seek", seconds: 10 });
    await run("drivebeats_control_playback", { action: "seek", seconds: 20 });
    expect(fetchCloudLibrarySync).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().currentTime).toBe(20);
  });

  it("keeps verified playback controls available without rebuilding a stale catalog or fetching offline", async () => {
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      duration: 100,
    });
    expect(await run("drivebeats_list_collections")).toMatchObject({
      ok: true,
    });
    useLibrarySearchStore.setState({ ensureReady: vi.fn(async () => false) });
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    expect(
      await run("drivebeats_control_playback", { action: "seek", seconds: 20 }),
    ).toMatchObject({ ok: true });
    expect(useLibrarySearchStore.getState().ensureReady).not.toHaveBeenCalled();
    expect(fetchCloudLibrarySync).toHaveBeenCalledOnce();
  });

  it("rejects a Library item removed while cloud collections are loading", async () => {
    const fetched = Promise.withResolvers<void>();
    const response = Promise.withResolvers<{ playlists: []; favorites: [] }>();
    vi.mocked(fetchCloudLibrarySync).mockImplementation(() => {
      fetched.resolve();
      return response.promise;
    });
    const playTrack = vi.fn(async () => true);
    usePlayerStore.setState({ playTrack });
    const result = run("drivebeats_play", { trackIds: [track.id] });
    await fetched.promise;
    useImportedDriveStore.setState({ rootFiles: [] });
    response.resolve({ playlists: [], favorites: [] });
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "library_unavailable" },
    });
    expect(playTrack).not.toHaveBeenCalled();
  });

  it("cancels a resume request without erasing the track, queue, position or shuffle", async () => {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<boolean>();
    const controller = new AbortController();
    const playerAudio = audio();
    playerAudio.currentTime = 120;
    const queue = [track];
    usePlayerStore.setState({
      audio: playerAudio,
      currentTrack: track,
      playlist: queue,
      currentIndex: 0,
      currentTime: 120,
      duration: 240,
      shuffle: true,
      play: vi.fn(() => {
        started.resolve();
        return finish.promise;
      }),
    });
    const result = run(
      "drivebeats_control_playback",
      { action: "resume" },
      controller.signal,
    );
    await started.promise;
    controller.abort();
    finish.resolve(false);
    expect(await result).toMatchObject({ ok: false });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      playlist: queue,
      currentTime: 120,
      shuffle: true,
      isPlaying: false,
    });
    expect(playerAudio.removeAttribute).not.toHaveBeenCalled();
  });

  it("does not expose persisted tracks or credentials while signed out, unknown, or logging out", async () => {
    usePlayerStore.setState({ currentTrack: track });
    for (const authStatus of ["unknown", "unauthenticated"] as const) {
      useAuthStore.setState({ authStatus });
      expect(await run("drivebeats_status")).toMatchObject({
        ok: true,
        signedIn: false,
      });
      expect(JSON.stringify(await run("drivebeats_status"))).not.toContain(
        "Needle",
      );
      expect(await run("drivebeats_search_library")).toMatchObject({
        ok: false,
        error: { code: "sign_in_required" },
      });
    }
    signIn();
    useAuthStore.setState({ isLoggingOut: true });
    expect(
      await run("drivebeats_control_playback", {
        action: "volume",
        volume: 0.1,
      }),
    ).toMatchObject({ ok: false, error: { code: "sign_in_required" } });
    expect(usePlayerStore.getState().volume).toBe(1);
  });

  it("redacts persisted playback filenames after switching accounts", async () => {
    signIn("account-b");
    // A delayed persisted snapshot must remain private even after switch cleanup.
    usePlayerStore.setState({ currentTrack: track, playlist: [track] });
    const result = await run("drivebeats_status");
    expect(result).toMatchObject({
      ok: true,
      signedIn: true,
      playback: { track: null, trackDetailsAvailable: false },
    });
    expect(JSON.stringify(result)).not.toContain("Needle");
  });

  it("searches filenames only and returns imported track IDs without tokens or tree", async () => {
    const result = await run("drivebeats_search_library", { query: "Needle" });
    expect(result).toMatchObject({
      ok: true,
      total: 1,
      tracks: [{ id: "imported", fileName: "Needle.mp3" }],
    });
    expect(JSON.stringify(result)).not.toContain("never-exposed");
    expect(JSON.stringify(result)).not.toContain("folderStack");
    expect(
      await run("drivebeats_search_library", {
        query: "Imported individually",
      }),
    ).toMatchObject({ ok: true, total: 0 });
  });

  it("rejects incomplete, wrong-account and changed-import catalogs", async () => {
    useLibrarySearchStore.setState({ ensureReady: vi.fn(async () => false) });
    expect(await run("drivebeats_search_library")).toMatchObject({
      ok: false,
      error: { code: "library_unavailable" },
    });
    useLibrarySearchStore.setState({ ensureReady: vi.fn(async () => true) });
    signIn("account-b");
    expect(await run("drivebeats_search_library")).toMatchObject({
      ok: false,
      error: { code: "library_unavailable" },
    });
    signIn();
    useImportedDriveStore.setState({ rootFiles: [] });
    expect(await run("drivebeats_search_library")).toMatchObject({
      ok: false,
      error: { code: "library_unavailable" },
    });
  });

  it("does not publish a catalog after account changes during readiness", async () => {
    let finish: (() => void) | undefined;
    useLibrarySearchStore.setState({
      ensureReady: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = () => resolve(true);
          }),
      ),
    });
    const result = run("drivebeats_search_library");
    signIn("account-b");
    finish?.();
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "account_changed" },
    });
  });

  it("reads cloud collections before exposing persisted playlists and drops changed-account responses", async () => {
    usePlaylistStore.setState({
      playlists: [
        { id: "old-account", name: "Private previous account", tracks: [] },
      ],
    });
    expect(await run("drivebeats_list_collections")).toMatchObject({
      ok: true,
      collections: [{ name: "Favorites" }],
    });
    expect(usePlaylistStore.getState().playlists).toEqual([]);
    let finish: (() => void) | undefined;
    vi.mocked(fetchCloudLibrarySync).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              playlists: [{ id: "account-a-only", name: "A", tracks: [] }],
              favorites: [],
            });
        }),
    );
    const result = run("drivebeats_list_collections");
    signIn("account-b");
    finish?.();
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "account_changed" },
    });
    expect(usePlaylistStore.getState().playlists).toEqual([]);
  });

  it("rejects arbitrary Drive IDs before playback", async () => {
    const playTrack = vi.fn(async () => true);
    usePlayerStore.setState({ playTrack });
    expect(
      await run("drivebeats_play", { trackIds: ["outside-drive-id"] }),
    ).toMatchObject({ ok: false, error: { code: "track_not_found" } });
    expect(playTrack).not.toHaveBeenCalled();
  });

  it("changes the ordinary player and reports observable playback truth", async () => {
    const playerAudio = audio();
    usePlayerStore.setState({
      audio: playerAudio,
      playTrack: vi.fn(async (currentTrack, playlist) => {
        Object.defineProperty(playerAudio, "paused", { value: false });
        usePlayerStore.setState({ currentTrack, playlist, isPlaying: true });
        return true;
      }),
    });
    expect(
      await run("drivebeats_play", { trackIds: ["imported"] }),
    ).toMatchObject({
      ok: true,
      playback: { isPlaying: true, track: { id: "imported" } },
    });
    await run("drivebeats_control_playback", { action: "volume", volume: 0.3 });
    expect(usePlayerStore.getState().volume).toBe(0.3);
    await run("drivebeats_control_playback", { action: "pause" });
    expect(playerAudio.pause).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("does not claim playback or invent an audio permission block from a successful store request", async () => {
    usePlayerStore.setState({
      playTrack: vi.fn(async () => true),
      isPlaying: true,
    });
    expect(
      await run("drivebeats_play", { trackIds: ["imported"] }),
    ).toMatchObject({ ok: false, error: { code: "playback_failed" } });
  });

  it("reports live UI-initiated playback without requiring a catalog refresh", async () => {
    const playerAudio = audio();
    Object.assign(playerAudio, {
      currentTime: 42.5,
      duration: 180,
      paused: false,
    });
    useLibrarySearchStore.setState({ catalog: null, status: "loading" });
    usePlayerStore.setState({
      audio: playerAudio,
      currentTrack: track,
      playlist: [track],
      playbackAccountId: "account-a",
      currentTime: 3,
      duration: 100,
      isPlaying: true,
      audioPermission: "allowed",
    });
    expect(await run("drivebeats_status")).toMatchObject({
      signedIn: true,
      library: { status: "loading", complete: false, trackCount: null },
      playback: {
        playerOpen: true,
        state: "playing",
        track: { id: "imported", fileName: "Needle.mp3" },
        positionSeconds: 42.5,
        durationSeconds: 180,
        remainingSeconds: 137.5,
        audioPermission: "allowed",
      },
    });
    expect(useLibrarySearchStore.getState().ensureReady).not.toHaveBeenCalled();
    expect(fetchCloudLibrarySync).not.toHaveBeenCalled();
    signIn("account-b");
    expect(await run("drivebeats_status")).toMatchObject({
      playback: { track: null },
    });
  });

  it("reports unknown duration and audio permission without pretending audio is authorized", async () => {
    const playerAudio = audio();
    Object.assign(playerAudio, { duration: Number.NaN });
    usePlayerStore.setState({ audio: playerAudio });
    const result = await run("drivebeats_status");
    expect(result).toMatchObject({
      playback: {
        playerOpen: false,
        state: "idle",
        audioPermission: "unknown",
        durationSeconds: null,
        remainingSeconds: null,
      },
    });
  });

  it("returns prepared-queue recovery for an observed audio permission failure", async () => {
    const playTrack = vi.fn(async (currentTrack, playlist) => {
      const playerAudio = audio();
      Object.assign(playerAudio, { src: "blob:prepared-test-audio" });
      usePlayerStore.setState({
        audio: playerAudio,
        currentTrack,
        playlist,
        playbackAccountId: "account-a",
        audioPermission: "blocked",
        lastPlaybackFailure: {
          code: "audio_user_interaction_required",
          message: "Tap Play in DriveBeats.",
        },
      });
      return false;
    });
    usePlayerStore.setState({ playTrack });
    const result = await run("drivebeats_play", { trackIds: [track.id] });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "audio_user_interaction_required" },
      playback: {
        queuePrepared: true,
        isPlaying: false,
        track: { id: track.id },
      },
      recovery: {
        action: "user_click_play",
        automaticRetry: false,
        verificationTool: "drivebeats_status",
      },
    });
    expect(playTrack).toHaveBeenCalledOnce();
    expect(await run("drivebeats_status")).toMatchObject({
      playback: { audioPermission: "blocked", queueLength: 1 },
    });
  });

  it("does not advise clicking Play when downloading audio failed", async () => {
    usePlayerStore.setState({
      playTrack: vi.fn(async () => {
        usePlayerStore.setState({
          lastPlaybackFailure: {
            code: "network_error",
            message: "Check your connection.",
          },
        });
        return false;
      }),
    });
    expect(
      await run("drivebeats_play", { trackIds: [track.id] }),
    ).toMatchObject({
      ok: false,
      error: { code: "network_error" },
      playback: { queuePrepared: false },
      recovery: { action: "inspect_state", automaticRetry: false },
    });
  });

  it("distinguishes failed Library reads from zero matches and preserves Drive permission recovery", async () => {
    useLibrarySearchStore.setState({
      failure: { code: "drive_access_denied", message: "Check Drive access." },
      ensureReady: vi.fn(async () => false),
    });
    const result = await run("drivebeats_search_library", { query: "Needle" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "drive_access_denied" },
      recovery: { action: "check_drive_access", automaticRetry: false },
    });
    expect(result).not.toHaveProperty("total");
    expect(await run("drivebeats_status")).toMatchObject({
      library: { error: { code: "drive_access_denied" } },
    });
  });

  it("returns scoped folder context and catalog freshness alongside filename search", async () => {
    useLibrarySearchStore.setState({
      catalog: {
        userId: "account-a",
        importsSignature: "track:imported",
        fetchedAt: 12345,
        tracks: [
          {
            ...track,
            contextLabel: "Artist/Album",
            folderStack: [
              { id: "root", name: "Library" },
              { id: "music", name: "Music" },
              { id: "album", name: "Album" },
            ],
          },
        ],
      },
    });
    expect(
      await run("drivebeats_search_library", { query: "Needle" }),
    ).toMatchObject({
      ok: true,
      search: {
        query: "Needle",
        searchFields: [
          "filename",
          "cached_title",
          "cached_artist",
          "cached_album",
        ],
        scope: "imported_library",
        complete: true,
        catalogUpdatedAt: 12345,
      },
      tracks: [
        {
          fileName: "Needle.mp3",
          folderPath: "Music/Album",
          contextLabel: "Artist/Album",
        },
      ],
    });
  });

  it("advertises exclusive Play alternatives and rejects neither or both at runtime", async () => {
    const schema = createDriveBeatsTools().find(
      (tool) => tool.name === "drivebeats_play",
    )?.inputSchema;
    expect(schema).toHaveProperty("anyOf");
    expect(await run("drivebeats_play", {})).toMatchObject({
      error: { code: "invalid_input" },
    });
    expect(
      await run("drivebeats_play", { collectionId: "p", trackIds: [track.id] }),
    ).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("edits verified saved tracks even when the complete Library is unavailable", async () => {
    const saved = createPlaylistTrack({ ...track, id: "saved" });
    vi.mocked(fetchCloudLibrarySync).mockResolvedValue({
      favorites: [saved],
      playlists: [{ id: "p", name: "Saved", tracks: [] }],
    });
    useLibrarySearchStore.setState({
      catalog: null,
      ensureReady: vi.fn(async () => false),
    });
    const addTracks = vi
      .spyOn(usePlaylistStore.getState(), "addTracks")
      .mockResolvedValue({
        addedCount: 1,
        duplicateCount: 0,
        skippedCount: 0,
        reachedTrackLimit: false,
      });
    const setFavorite = vi
      .spyOn(useLibraryStore.getState(), "setFavorite")
      .mockImplementation(async () => {
        useLibraryStore.setState({ tracks: {} });
      });
    expect(
      await run("drivebeats_edit_playlist_tracks", {
        action: "add",
        playlistId: "p",
        trackIds: ["saved"],
      }),
    ).toMatchObject({ ok: true, addedCount: 1 });
    expect(
      await run("drivebeats_set_favorite", {
        trackId: "saved",
        favorite: false,
      }),
    ).toMatchObject({ ok: true });
    expect(addTracks).toHaveBeenCalledWith("p", [saved]);
    expect(setFavorite).toHaveBeenCalledWith(saved, false);
    expect(useLibrarySearchStore.getState().ensureReady).not.toHaveBeenCalled();
  });

  it("requires collection verification after a creation whose completion became uncertain", async () => {
    vi.spyOn(usePlaylistStore.getState(), "createPlaylist").mockImplementation(
      async () => {
        throw new TypeError("connection interrupted after submission");
      },
    );
    expect(
      await run("drivebeats_save_playlist", { name: "Evening" }),
    ).toMatchObject({
      ok: false,
      effectMayHaveOccurred: true,
      recovery: {
        action: "verify_collections",
        automaticRetry: false,
        verificationTool: "drivebeats_list_collections",
      },
    });
  });

  it("does not claim a Favorite change happened when its prerequisite read failed", async () => {
    useLibrarySearchStore.setState({
      failure: { code: "network_error", message: "Check your connection." },
      ensureReady: vi.fn(async () => false),
    });
    const setFavorite = vi.spyOn(useLibraryStore.getState(), "setFavorite");
    const result = await run("drivebeats_set_favorite", {
      trackId: track.id,
      favorite: true,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "network_error" },
      recovery: { automaticRetry: false },
    });
    expect(result).not.toHaveProperty("effectMayHaveOccurred");
    expect(JSON.stringify(result)).not.toContain("Playlist creation");
    expect(setFavorite).not.toHaveBeenCalled();
  });

  it("reports offline recovery without starting a refresh or invalidating a fresh catalog", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    expect(
      await run("drivebeats_search_library", { query: "Needle" }),
    ).toMatchObject({
      ok: false,
      error: { code: "offline" },
      recovery: { action: "check_connection", automaticRetry: false },
    });
    expect(useLibrarySearchStore.getState().ensureReady).not.toHaveBeenCalled();
    expect(await run("drivebeats_status")).toMatchObject({
      library: { status: "ready", complete: true, searchable: false },
    });
  });

  it("rejects stale account queues before resuming", async () => {
    const play = vi.fn(async () => true);
    usePlayerStore.setState({
      currentTrack: { ...track, id: "old-user-track" },
      playlist: [{ ...track, id: "old-user-track" }],
      play,
    });
    expect(
      await run("drivebeats_control_playback", { action: "resume" }),
    ).toMatchObject({ ok: false, error: { code: "track_not_found" } });
    expect(play).not.toHaveBeenCalled();
  });

  it("cancellation and account changes stop an in-flight player action", async () => {
    for (const changeAccount of [false, true]) {
      signIn();
      let finish: (() => void) | undefined;
      let started: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const resetPlayback = vi.spyOn(
        usePlayerStore.getState(),
        "resetPlayback",
      );
      usePlayerStore.setState({
        currentTrack: track,
        playlist: [track],
        resetPlayback,
        play: vi.fn(() => {
          started?.();
          return new Promise<boolean>((resolve) => {
            finish = () => resolve(false);
          });
        }),
      });
      const controller = new AbortController();
      const result = run(
        "drivebeats_control_playback",
        { action: "resume" },
        controller.signal,
      );
      await ready;
      if (changeAccount) signIn("account-b");
      else controller.abort();
      if (changeAccount) expect(resetPlayback).toHaveBeenCalledOnce();
      else {
        expect(resetPlayback).not.toHaveBeenCalled();
        expect(usePlayerStore.getState().currentTrack).toBe(track);
        expect(usePlayerStore.getState().isPlaying).toBe(false);
      }
      finish?.();
      expect(await result).toMatchObject({ ok: false });
    }
  });

  it("does not cancel a newer track selected manually while a tool is waiting", async () => {
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resetPlayback = vi.fn();
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      resetPlayback,
      play: vi.fn(() => {
        started?.();
        return new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        });
      }),
    });
    const controller = new AbortController();
    const result = run(
      "drivebeats_control_playback",
      { action: "resume" },
      controller.signal,
    );
    await ready;
    const manuallySelected = { ...track, id: "manual-track" };
    usePlayerStore.setState({
      currentTrack: manuallySelected,
      pendingTrackId: null,
    });
    controller.abort();
    expect(resetPlayback).not.toHaveBeenCalled();
    finish?.();
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(usePlayerStore.getState().currentTrack).toBe(manuallySelected);
  });

  it("previous rewinds an already-paused track without claiming playback failed", async () => {
    const playerAudio = audio();
    playerAudio.currentTime = 10;
    usePlayerStore.setState({
      audio: playerAudio,
      currentTrack: track,
      playlist: [track],
      currentIndex: 0,
      duration: 100,
    });
    expect(
      await run("drivebeats_control_playback", { action: "previous" }),
    ).toMatchObject({ ok: true, playback: { isPlaying: false } });
    expect(playerAudio.currentTime).toBe(0);
  });

  it("validates arguments rather than trusting host schema enforcement", async () => {
    expect(
      await run("drivebeats_control_playback", { action: "volume", volume: 2 }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(usePlayerStore.getState().volume).toBe(1);
    expect(
      await run("drivebeats_play", {
        collectionId: "a",
        trackIds: ["imported"],
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("shared local metadata tools", () => {
  it("returns a restricted page without serializing the whole oversized Library", async () => {
    const tracks = Array.from({ length: 50_001 }, (_, index) => ({
      ...track,
      id: `track-${index}`,
    }));
    const catalog = useLibrarySearchStore.getState().catalog;
    if (!catalog) throw new Error("Missing catalog");
    useLibrarySearchStore.setState({ catalog: { ...catalog, tracks } });
    const serializeTags = vi.spyOn(cachedTags, "getCachedTrackTags");
    expect(
      await run("drivebeats_search_library", { limit: 2, offset: 10 }),
    ).toMatchObject({
      ok: true,
      total: 50_001,
      tracks: [{ id: "track-10" }, { id: "track-11" }],
      nextCursor: null,
      restriction: "snapshot_limit",
      search: { complete: false },
    });
    expect(serializeTags.mock.calls.length).toBeLessThan(10);
  });

  it("reports an in-progress catalog when its bounded foreground allowance ends", async () => {
    useLibrarySearchStore.setState({
      catalog: null,
      status: "loading",
      ensureReady: vi.fn(async () => false),
    });
    expect(
      await run("drivebeats_search_library", { query: "Needle" }),
    ).toMatchObject({ ok: false, error: { code: "library_indexing" } });
  });

  it("rejects a search if a new catalog replaces its source during the local cache scan", async () => {
    vi.spyOn(metadataCacheDb, "readMetadataRecords").mockImplementation(
      async () => {
        const current = useLibrarySearchStore.getState().catalog;
        if (!current) throw new Error("Missing catalog");
        useLibrarySearchStore.setState({
          catalog: { ...current, fetchedAt: current.fetchedAt + 1 },
        });
        return true;
      },
    );
    expect(
      await run("drivebeats_search_library", { query: "Needle" }),
    ).toMatchObject({ ok: false, error: { code: "search_changed" } });
  });

  it("removes completed metadata from a batch output when its membership disappears while another track waits", async () => {
    const second = { ...track, id: "second", name: "Second.mp3" };
    const initial = useLibrarySearchStore.getState().catalog;
    if (!initial) throw new Error("Missing catalog");
    useImportedDriveStore.setState({ rootFiles: [track, second] });
    useLibrarySearchStore.setState({
      catalog: {
        ...initial,
        importsSignature: "track:imported|track:second",
        tracks: [track, second],
      },
      invalidated: false,
    });
    let release!: (
      value: Awaited<ReturnType<typeof metadataLoader.ensureTrackMetadata>>,
    ) => void;
    const gate = new Promise<
      Awaited<ReturnType<typeof metadataLoader.ensureTrackMetadata>>
    >((resolve) => {
      release = resolve;
    });
    const ensure = vi
      .spyOn(metadataLoader, "ensureTrackMetadata")
      .mockImplementation(async (known) => {
        if (known.track.id === "second") return gate;
        return {
          metadata: {
            status: "ready",
            freshness: "current",
            tags: { title: "Removed private tag" },
          },
          loadedNow: true,
        };
      });
    const pending = run("drivebeats_load_track_metadata", {
      trackIds: ["imported", "second"],
    });
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
    useImportedDriveStore.setState({ rootFiles: [second] });
    useLibrarySearchStore.setState({
      catalog: {
        ...initial,
        importsSignature: "track:second",
        tracks: [second],
      },
      invalidated: false,
    });
    release({
      metadata: { status: "missing", freshness: "unknown" },
      loadedNow: false,
    });
    const result = await pending;
    expect(result).toMatchObject({
      ok: true,
      tracks: [
        { id: "imported", metadata: { status: "unavailable" } },
        { id: "second" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Removed private tag");
    expect(JSON.stringify(result)).not.toContain("Needle.mp3");
  });

  const versioned = {
    ...track,
    size: "2048",
    modifiedTime: "2026-10-22T00:00:00Z",
  };
  async function seed() {
    const second = { ...versioned, id: "second", name: "Other.mp3" };
    useImportedDriveStore.setState({ rootFiles: [versioned, second] });
    useLibrarySearchStore.setState({
      catalog: {
        userId: "account-a",
        fetchedAt: 900,
        importsSignature: "track:imported|track:second",
        tracks: [versioned, second],
      },
      invalidated: false,
    });
    useId3MetadataStore.getState().getRecord(versioned);
    await useId3MetadataStore.getState().putRecord(versioned, {
      status: "ready",
      tags: { title: "Original", artist: "Needle artist", album: "Blue" },
      loadedVia: "local_blob",
    });
    return second;
  }
  it("searches across filename and cached fields with token AND semantics", async () => {
    await seed();
    const result = await run("drivebeats_search_library", {
      query: "needle blue",
    });
    expect(result).toMatchObject({
      ok: true,
      total: 1,
      tracks: [
        {
          id: "imported",
          matchedFields: ["filename", "cached_artist", "cached_album"],
          metadata: { status: "ready" },
          display: { title: "Original", titleSource: "audio_tags" },
        },
      ],
    });
    expect(fetchCloudLibrarySync).not.toHaveBeenCalled();
  });
  it("browses compact pages without losing recording labels or changing format on continuation", async () => {
    const second = await seed();
    const catalog = useLibrarySearchStore.getState().catalog;
    if (!catalog) throw new Error("Expected seeded catalog");
    useLibrarySearchStore.setState({
      catalog: {
        ...catalog,
        tracks: catalog.tracks.map((item) =>
          item.id === "imported"
            ? { ...item, name: "Artist - Original (Club Remix).mp3" }
            : item,
        ),
      },
    });
    const detailed = await run("drivebeats_search_library", { limit: 1 });
    const first = await run("drivebeats_search_library", {
      format: "compact",
      limit: 1,
    });
    expect(first).toMatchObject({
      ok: true,
      total: 2,
      search: { format: "compact", query: "", complete: true },
      tracks: [
        {
          id: "imported",
          fileName: "Artist - Original (Club Remix).mp3",
          title: "Original",
          artist: "Needle artist",
          album: "Blue",
          titleSource: "audio_tags",
        },
      ],
    });
    expect(JSON.stringify(first.tracks).length).toBeLessThan(
      JSON.stringify(detailed.tracks).length,
    );
    expect(
      await run("drivebeats_search_library", { cursor: first.nextCursor }),
    ).toMatchObject({
      ok: true,
      tracks: [{ id: second.id, artist: null, album: null }],
      search: { format: "compact" },
      nextCursor: null,
    });
    expect(
      await run("drivebeats_search_library", {
        cursor: first.nextCursor,
        filters: { artist: "different" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
  it("does not label stale cached artists or albums as current compact identity", async () => {
    await seed();
    const catalog = useLibrarySearchStore.getState().catalog;
    if (!catalog) throw new Error("Expected seeded catalog");
    useLibrarySearchStore.setState({
      catalog: {
        ...catalog,
        tracks: catalog.tracks.map((item) => ({
          ...item,
          modifiedTime: "2026-10-23T00:00:00Z",
        })),
      },
    });
    const result = await run("drivebeats_search_library", {
      format: "compact",
    });
    expect(result).toMatchObject({
      ok: true,
      tracks: [
        {
          id: "imported",
          artist: null,
          album: null,
          titleSource: "filename",
          artistSource: null,
          metadataFreshness: "stale",
        },
        { id: "second" },
      ],
    });
  });
  it("combines tag and collection filters and excludes missing tags without a false complete metadata claim", async () => {
    await seed();
    vi.mocked(fetchCloudLibrarySync).mockResolvedValue({
      playlists: [
        {
          id: "p",
          name: "Set",
          tracks: [
            createPlaylistTrack(versioned),
            createPlaylistTrack({ ...versioned, id: "second" }),
          ],
        },
        {
          id: "exclude",
          name: "Skip",
          tracks: [createPlaylistTrack({ ...versioned, id: "second" })],
        },
      ],
      favorites: [createPlaylistTrack(versioned)],
    });
    const result = await run("drivebeats_search_library", {
      format: "compact",
      filters: {
        artist: "NEEDLE",
        album: "blu",
        favorite: true,
        collectionId: "p",
        excludeCollectionId: "exclude",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      total: 1,
      tracks: [{ id: "imported" }],
      search: {
        filters: { favorite: true },
        metadataCoverage: expect.any(Object),
      },
    });
    expect(
      await run("drivebeats_search_library", { filters: { favorite: false } }),
    ).toMatchObject({ ok: true, total: 1, tracks: [{ id: "second" }] });
    expect(
      await run("drivebeats_search_library", { filters: { album: "missing" } }),
    ).toMatchObject({ ok: true, total: 0 });
    expect(
      await run("drivebeats_search_library", {
        filters: { collectionId: "unknown" },
      }),
    ).toMatchObject({ ok: false, error: { code: "collection_not_found" } });
  });
  it("keeps cursor tag values and results stable during cache warming", async () => {
    const second = await seed();
    const first = await run("drivebeats_search_library", {
      query: "",
      limit: 1,
    });
    await useId3MetadataStore.getState().putRecord(second, {
      status: "ready",
      tags: { title: "Added later" },
      loadedVia: "local_blob",
    });
    const next = await run("drivebeats_search_library", {
      cursor: first.nextCursor,
    });
    expect(next).toMatchObject({
      ok: true,
      total: 2,
      tracks: [{ id: "second", metadata: { status: "missing" } }],
    });
    const fresh = await run("drivebeats_search_library", { query: "added" });
    expect(fresh).toMatchObject({ ok: true, total: 1 });
  });
  it("rejects cursor scope changes before returning cached private rows", async () => {
    await seed();
    const first = await run("drivebeats_search_library", { limit: 1 });
    useImportedDriveStore.setState({ rootFiles: [] });
    const next = await run("drivebeats_search_library", {
      cursor: first.nextCursor,
    });
    expect(next).toMatchObject({
      ok: false,
      error: { code: "search_changed" },
    });
    expect(next).not.toHaveProperty("tracks");
  });
  it("cache_only never verifies unknown IDs with the cloud or Drive", async () => {
    await seed();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await run("drivebeats_load_track_metadata", {
      trackIds: ["imported", "foreign"],
      mode: "cache_only",
    });
    expect(result).toMatchObject({
      ok: true,
      budget: { requestsUsed: 0, bytesRead: 0 },
      tracks: [
        { id: "imported", metadata: { status: "ready" }, loadedNow: false },
        {
          id: "foreign",
          metadata: { status: "unavailable" },
          error: { code: "track_not_found" },
        },
      ],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchCloudLibrarySync).not.toHaveBeenCalled();
  });
  it("cache_only returns evicted durable tags without Drive or cloud reads", async () => {
    await seed();
    const record = useId3MetadataStore.getState().records.imported;
    useId3MetadataStore.setState({ records: {}, cache: {} });
    vi.spyOn(metadataCacheDb, "loadMetadataRecord").mockResolvedValue({
      record,
      epoch: 0,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await run("drivebeats_load_track_metadata", {
      trackIds: ["imported"],
      mode: "cache_only",
    });
    expect(result).toMatchObject({
      ok: true,
      remainingTrackIds: [],
      tracks: [
        {
          metadata: {
            status: "ready",
            freshness: "current",
            tags: { title: "Original" },
          },
        },
      ],
      budget: { requestsUsed: 0, bytesRead: 0 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchCloudLibrarySync).not.toHaveBeenCalled();
  });
  it.each(["ready", "no_target_tags", "unresolved"] as const)(
    "keeps stale %s records in remainingTrackIds",
    async (status) => {
      await seed();
      const record = useId3MetadataStore.getState().records.imported;
      useId3MetadataStore.setState({
        records: {
          imported: { ...record, status, fingerprint: "old-content" },
        },
      });
      const result = await run("drivebeats_load_track_metadata", {
        trackIds: ["imported"],
        mode: "cache_only",
      });
      expect(result).toMatchObject({
        ok: true,
        remainingTrackIds: ["imported"],
        tracks: [{ metadata: { status, freshness: "stale" } }],
      });
    },
  );
  it("keeps stale outcomes returned during a load_missing backoff retryable", async () => {
    await seed();
    vi.spyOn(metadataLoader, "ensureTrackMetadata").mockResolvedValue({
      metadata: {
        status: "ready",
        freshness: "stale",
        error: { code: "network_error", retryable: true },
      },
      loadedNow: false,
    });
    const result = await run("drivebeats_load_track_metadata", {
      trackIds: ["imported"],
      mode: "load_missing",
    });
    expect(result).toMatchObject({ ok: true, remainingTrackIds: ["imported"] });
  });
  it("rejects duplicate IDs and unknown arguments without executing work", async () => {
    expect(
      await run("drivebeats_load_track_metadata", { trackIds: ["x", "x"] }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await run("drivebeats_load_track_metadata", {
        trackIds: ["x"],
        force: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(fetchCloudLibrarySync).not.toHaveBeenCalled();
  });
});
