import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCloudLibrarySync } from "@/lib/cloud-library-api";
import type { LibrarySearchTrack } from "@/lib/library-search-catalog";
import { createDriveBeatsTools } from "@/lib/webmcp-tools";
import { useAuthStore } from "@/stores/auth-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { useLibrarySearchStore } from "@/stores/library-search-store";
import { useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";

vi.mock("@/lib/cloud-library-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloud-library-api")>()),
  fetchCloudLibrarySync: vi.fn(),
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

beforeEach(() => {
  vi.restoreAllMocks();
  signIn();
  useImportedDriveStore.setState({ rootFolders: [], rootFiles: [track] });
  useLibrarySearchStore.setState({
    catalog: {
      userId: "account-a",
      fetchedAt: Date.now(),
      importsSignature: "track:imported",
      tracks: [track],
    },
    invalidated: false,
    ensureReady: vi.fn(async () => true),
  });
  usePlaylistStore.setState({ playlists: [], isCloudHydrated: false });
  useLibraryStore.setState({ tracks: {}, isCloudHydrated: false });
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
    usePlayerStore.setState({ currentTrack: track, playlist: [track] });
    signIn("account-b");
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

  it("reports blocked audio despite a successful store request", async () => {
    usePlayerStore.setState({
      playTrack: vi.fn(async () => true),
      isPlaying: true,
    });
    expect(
      await run("drivebeats_play", { trackIds: ["imported"] }),
    ).toMatchObject({ ok: false, error: { code: "playback_blocked" } });
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
      const resetPlayback = vi.fn();
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
      expect(resetPlayback).toHaveBeenCalledOnce();
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
