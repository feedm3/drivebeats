import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadGoogleDriveFileMedia } from "@/lib/google-api";
import * as offlineDb from "@/lib/offline-db";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

vi.mock("@/lib/google-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-api")>()),
  downloadGoogleDriveFileMedia: vi.fn(),
}));
vi.mock("@/lib/offline-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-db")>()),
  getTrack: vi.fn(),
}));
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: { getState: () => ({ requestMetadata: vi.fn() }) },
}));

const initialPlayer = usePlayerStore.getState();
const initialAuth = useAuthStore.getState();
const track: DriveFile = {
  id: "selected",
  name: "Selected.mp3",
  mimeType: "audio/mpeg",
};
const secondTrack: DriveFile = { ...track, id: "second", name: "Second.mp3" };
let audio: HTMLAudioElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = vi.fn();
    },
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  useAuthStore.setState({
    ...initialAuth,
    user: {
      id: "account-one",
      email: "user@example.com",
      name: null,
      picture: null,
    },
    authStatus: "authenticated",
    getValidAccessToken: vi.fn(async () => "test-token"),
    refreshAccessToken: vi.fn(async () => true),
    accessToken: "refreshed-token",
  });
  audio = document.createElement("audio");
  Object.defineProperty(audio, "paused", { value: true, writable: true });
  vi.spyOn(audio, "pause").mockImplementation(() =>
    Object.defineProperty(audio, "paused", { value: true, writable: true }),
  );
  vi.spyOn(audio, "load").mockImplementation(() => undefined);
  vi.spyOn(audio, "play").mockImplementation(async () => {
    Object.defineProperty(audio, "paused", { value: false, writable: true });
  });
  usePlayerStore.setState({
    ...initialPlayer,
    audio,
    blobCache: new Map([
      [track.id, "blob:selected"],
      [secondTrack.id, "blob:second"],
    ]),
    currentTrack: null,
    playlist: [],
    lastPlaybackFailure: null,
    audioPermission: "unknown",
    playbackAccountId: null,
    prefetchNextTrack: vi.fn(),
  });
  vi.mocked(offlineDb.getTrack).mockResolvedValue(undefined);
});
afterEach(() => {
  usePlayerStore.setState({ audio: null });
  usePlayerStore.getState().resetPlayback();
  useAuthStore.setState(initialAuth);
  usePlayerStore.setState(initialPlayer);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const play = () => usePlayerStore.getState().playTrack(track, [track], []);

describe("typed playback outcomes", () => {
  it("reports a prepared track blocked by browser interaction without re-downloading it", async () => {
    vi.mocked(audio.play).mockRejectedValueOnce(
      new DOMException(
        "private URL and token should never be returned",
        "NotAllowedError",
      ),
    );
    expect(await play()).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      playbackAccountId: "account-one",
      audioPermission: "blocked",
      isPlaying: false,
      lastPlaybackFailure: {
        code: "audio_user_interaction_required",
        message:
          "Tap Play in DriveBeats once to allow audio in this browser, then try again.",
      },
    });
    expect(downloadGoogleDriveFileMedia).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("keeps offline autoplay rejection separate from an IndexedDB failure", async () => {
    usePlayerStore.setState({ blobCache: new Map() });
    vi.mocked(offlineDb.getTrack).mockResolvedValueOnce({
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      sizeBytes: 5,
      mimeType: "audio/mpeg",
      name: track.name,
      modifiedTime: undefined,
      downloadedAt: Date.now(),
    });
    vi.mocked(audio.play).mockRejectedValueOnce(
      new DOMException("Autoplay blocked", "NotAllowedError"),
    );
    expect(await play()).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(
      "audio_user_interaction_required",
    );
    expect(usePlayerStore.getState().audioPermission).toBe("blocked");
    expect(downloadGoogleDriveFileMedia).not.toHaveBeenCalled();
    expect(useAuthStore.getState().getValidAccessToken).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("records allowed only after audio actually plays, retains it on pause, and clears the prior failure", async () => {
    vi.mocked(audio.play).mockRejectedValueOnce(
      new DOMException("Blocked", "NotAllowedError"),
    );
    expect(await play()).toBe(false);
    expect(usePlayerStore.getState().audioPermission).toBe("blocked");
    expect(await usePlayerStore.getState().play()).toBe(true);
    expect(usePlayerStore.getState()).toMatchObject({
      audioPermission: "allowed",
      lastPlaybackFailure: null,
    });
    usePlayerStore.getState().pause();
    expect(usePlayerStore.getState().audioPermission).toBe("allowed");
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    const persisted = JSON.parse(
      localStorage.getItem("drivebeats-player") ?? "{}",
    ).state;
    expect(persisted).not.toHaveProperty("audioPermission");
    expect(persisted).not.toHaveProperty("lastPlaybackFailure");
    expect(persisted).not.toHaveProperty("playbackAccountId");
  });

  it.each([
    ["NotSupportedError", "unsupported_audio"],
    ["UnknownError", "playback_failed"],
  ])(
    "preserves %s as %s without claiming an interaction block",
    async (name, code) => {
      vi.mocked(audio.play).mockRejectedValueOnce(
        new DOMException("Private raw diagnostic", name),
      );
      expect(await play()).toBe(false);
      expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(code);
      expect(
        usePlayerStore.getState().lastPlaybackFailure?.message,
      ).not.toContain("Private");
      expect(usePlayerStore.getState().audioPermission).toBe("unknown");
    },
  );

  it("does not report intentional cancellation as an audio block", async () => {
    vi.mocked(audio.play).mockRejectedValueOnce(
      new DOMException("Cancelled", "AbortError"),
    );
    expect(await play()).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure).toBeNull();
    expect(usePlayerStore.getState().audioPermission).toBe("unknown");
  });

  it("bounds a stalled audio start with a distinct playback timeout", async () => {
    vi.mocked(audio.play).mockReturnValueOnce(new Promise<void>(() => {}));
    const pending = play();
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await pending).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(
      "playback_timeout",
    );
    expect(usePlayerStore.getState().audioPermission).toBe("unknown");
    expect(audio.pause).not.toHaveBeenCalled();
  });

  it("allows a fresh source to buffer longer than the short resume deadline", async () => {
    vi.mocked(audio.play).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            Object.defineProperty(audio, "paused", {
              value: false,
              writable: true,
            });
            resolve();
          }, 2000);
        }),
    );
    const pending = play();
    await vi.advanceTimersByTimeAsync(1600);
    expect(usePlayerStore.getState().lastPlaybackFailure).toBeNull();
    expect(audio.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe(true);
    expect(usePlayerStore.getState().audioPermission).toBe("allowed");
  });

  it("retains the short timeout for resuming an existing source", async () => {
    audio.src = "blob:selected";
    usePlayerStore.setState({ currentTrack: track, playlist: [track] });
    vi.mocked(audio.play).mockReturnValueOnce(new Promise<void>(() => {}));
    const pending = usePlayerStore.getState().play();
    await vi.advanceTimersByTimeAsync(1600);
    expect(await pending).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(
      "playback_timeout",
    );
    expect(usePlayerStore.getState().audioPermission).toBe("unknown");
  });

  it.each(["NotAllowedError", "no-start"])(
    "preserves visible iOS standalone source recovery after %s",
    async (failure) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: true })),
      );
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      audio.src = "blob:selected";
      usePlayerStore.setState({
        currentTrack: track,
        playlist: [track],
        playbackAccountId: "account-one",
      });
      if (failure === "NotAllowedError")
        vi.mocked(audio.play).mockRejectedValueOnce(
          new DOMException("Blocked resume", "NotAllowedError"),
        );
      else vi.mocked(audio.play).mockResolvedValueOnce(undefined);
      vi.mocked(audio.load).mockImplementation(() => {
        queueMicrotask(() => audio.dispatchEvent(new Event("loadedmetadata")));
      });
      expect(await usePlayerStore.getState().play()).toBe(true);
      expect(audio.load).toHaveBeenCalledOnce();
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(usePlayerStore.getState()).toMatchObject({
        isPlaying: true,
        audioPermission: "allowed",
        lastPlaybackFailure: null,
      });
    },
  );

  it("clears pending download state on token expiry and permits navigation after signing in again", async () => {
    usePlayerStore.setState({
      blobCache: new Map([[secondTrack.id, "blob:second"]]),
      playlist: [track, secondTrack],
      currentTrack: secondTrack,
    });
    const download = Promise.withResolvers<Response>();
    vi.mocked(downloadGoogleDriveFileMedia).mockReturnValueOnce(
      download.promise,
    );
    const pending = usePlayerStore
      .getState()
      .playTrack(track, [track, secondTrack], []);
    await Promise.resolve();
    await Promise.resolve();
    expect(usePlayerStore.getState()).toMatchObject({
      pendingTrackId: track.id,
      isLoading: true,
    });
    useAuthStore.getState().clearTokens();
    expect(usePlayerStore.getState()).toMatchObject({
      pendingTrackId: null,
      isLoading: false,
      lastPlaybackFailure: null,
      audioPermission: "unknown",
      playbackAccountId: null,
    });
    useAuthStore.setState({
      user: {
        id: "account-one",
        email: "user@example.com",
        name: null,
        picture: null,
      },
      authStatus: "authenticated",
    });
    download.reject(new DOMException("Request aborted", "AbortError"));
    expect(await pending).toBe(false);
    // Re-established session can navigate its restored collection without
    // an obsolete pending row preventing Next from starting playback.
    usePlayerStore.setState({
      currentTrack: track,
      currentIndex: 0,
      playlist: [track, secondTrack],
      blobCache: new Map([[secondTrack.id, "blob:new-session-second"]]),
    });
    await usePlayerStore.getState().next();
    expect(usePlayerStore.getState().currentTrack).toBe(secondTrack);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().pendingTrackId).toBeNull();
    expect(usePlayerStore.getState().isLoading).toBe(false);
  });

  it.each([
    [401, "drive_auth_required"],
    [403, "drive_access_denied"],
    [404, "track_unavailable"],
    [429, "drive_rate_limited"],
    [503, "drive_unavailable"],
  ])("distinguishes Drive HTTP %s as %s", async (status, code) => {
    usePlayerStore.setState({ blobCache: new Map() });
    vi.mocked(downloadGoogleDriveFileMedia).mockResolvedValue(
      new Response(null, { status }),
    );
    expect(await play()).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(code);
    expect(usePlayerStore.getState().audioPermission).toBe("unknown");
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("distinguishes failed browser transport from audio playback permission", async () => {
    usePlayerStore.setState({ blobCache: new Map() });
    vi.mocked(downloadGoogleDriveFileMedia).mockRejectedValueOnce(
      new TypeError("Failed to fetch private URL"),
    );
    expect(await play()).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(
      "network_error",
    );
    expect(usePlayerStore.getState().audioPermission).toBe("unknown");
  });

  it("cannot overwrite a newer successful track with an older audio rejection", async () => {
    const earlier = Promise.withResolvers<void>();
    vi.mocked(audio.play).mockReturnValueOnce(earlier.promise);
    const old = play();
    expect(
      await usePlayerStore.getState().playTrack(secondTrack, [secondTrack], []),
    ).toBe(true);
    earlier.reject(new DOMException("Old blocked request", "NotAllowedError"));
    expect(await old).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: secondTrack,
      audioPermission: "allowed",
      lastPlaybackFailure: null,
      playbackAccountId: "account-one",
    });
  });

  it("cannot let an earlier resume's source load overwrite a newer resume outcome", async () => {
    usePlayerStore.setState({ currentTrack: track, playlist: [track] });
    const earlier = Promise.withResolvers<void>();
    vi.mocked(audio.play).mockReturnValueOnce(earlier.promise);
    const old = usePlayerStore.getState().play();
    expect(await usePlayerStore.getState().play()).toBe(true);
    earlier.reject(new DOMException("Old blocked resume", "NotAllowedError"));
    expect(await old).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      audioPermission: "allowed",
      lastPlaybackFailure: null,
      isPlaying: true,
    });
  });

  it("preserves a newer successful resume when the prepared track's earlier start rejects", async () => {
    const earlier = Promise.withResolvers<void>();
    vi.mocked(audio.play).mockReturnValueOnce(earlier.promise);
    const old = play();
    expect(await usePlayerStore.getState().play()).toBe(true);
    earlier.reject(new DOMException("Old blocked start", "NotAllowedError"));
    expect(await old).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      pendingTrackId: null,
      audioPermission: "allowed",
      lastPlaybackFailure: null,
      isPlaying: true,
    });
  });

  it("aborts a pending replacement download when resuming the current audio source", async () => {
    audio.src = "blob:selected";
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track, secondTrack],
      blobCache: new Map(),
    });
    const replacement = Promise.withResolvers<Response>();
    vi.mocked(downloadGoogleDriveFileMedia).mockReturnValueOnce(
      replacement.promise,
    );
    const loading = usePlayerStore
      .getState()
      .playTrack(secondTrack, [track, secondTrack], []);
    await Promise.resolve();
    await Promise.resolve();
    expect(downloadGoogleDriveFileMedia).toHaveBeenCalled();
    const signal = vi.mocked(downloadGoogleDriveFileMedia).mock.calls[0][2];
    expect(signal?.aborted).toBe(false);
    expect(await usePlayerStore.getState().play()).toBe(true);
    expect(signal?.aborted).toBe(true);
    replacement.reject(new DOMException("Replacement cancelled", "AbortError"));
    expect(await loading).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      pendingTrackId: null,
      isLoading: false,
      isPlaying: true,
    });
  });

  it("remembers ownership through an unauthenticated interval before a different account signs in", async () => {
    expect(await play()).toBe(true);
    useAuthStore.getState().clearTokens();
    // A persisted or retained device queue from the original account is still
    // present when bootstrap learns the next identity.
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      blobCache: new Map([[track.id, "blob:old-owner"]]),
    });
    useAuthStore.setState({
      user: {
        id: "account-two",
        email: "other@example.com",
        name: null,
        picture: null,
      },
      authStatus: "authenticated",
    });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: null,
      playlist: [],
      playbackAccountId: null,
      lastPlaybackFailure: null,
      audioPermission: "unknown",
    });
    expect(audio.src).toBe("");
    expect(usePlayerStore.getState().blobCache.size).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old-owner");
  });

  it("clears observations and ownership on reset, ignoring the pending rejection", async () => {
    const earlier = Promise.withResolvers<void>();
    vi.mocked(audio.play).mockReturnValueOnce(earlier.promise);
    const old = play();
    usePlayerStore.getState().resetPlayback();
    earlier.reject(new DOMException("Old blocked request", "NotAllowedError"));
    expect(await old).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      audioPermission: "unknown",
      lastPlaybackFailure: null,
      playbackAccountId: null,
      currentTrack: null,
    });
  });

  it("clears old audio, queue, cached sources, and observations on a confirmed account switch", async () => {
    expect(await play()).toBe(true);
    useAuthStore.setState({
      user: {
        id: "account-two",
        email: "other@example.com",
        name: null,
        picture: null,
      },
    });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: null,
      playlist: [],
      audioPermission: "unknown",
      lastPlaybackFailure: null,
      playbackAccountId: null,
    });
    expect(audio.src).toBe("");
    expect(audio.paused).toBe(true);
    expect(usePlayerStore.getState().blobCache.size).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:selected");
  });

  it("does not reset a same-account device queue a second time during post-expiry hydration", async () => {
    expect(await play()).toBe(true);
    useAuthStore.getState().clearTokens();
    // The queue feature may clear on expiry; a same-account device collection
    // restored during the signed-out interval must survive account hydration.
    const files = [track];
    const cache = new Map([[track.id, "blob:same-owner-restored"]]);
    usePlayerStore.setState({
      currentTrack: track,
      playlist: files,
      blobCache: cache,
      playbackAccountId: null,
    });
    useAuthStore.setState({
      user: {
        id: "account-one",
        email: "user@example.com",
        name: null,
        picture: null,
      },
      authStatus: "authenticated",
    });
    expect(usePlayerStore.getState().currentTrack).toBe(track);
    expect(usePlayerStore.getState().playlist).toBe(files);
    expect(usePlayerStore.getState().blobCache).toBe(cache);
    expect(cache.get(track.id)).toBe("blob:same-owner-restored");
    expect(usePlayerStore.getState().playbackAccountId).toBeNull();
  });

  it("preserves a persisted queue during initial account hydration without claiming ownership", () => {
    useAuthStore.setState({ user: null });
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      playbackAccountId: null,
      audioPermission: "unknown",
    });
    useAuthStore.setState({
      user: {
        id: "account-one",
        email: "user@example.com",
        name: null,
        picture: null,
      },
    });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      playlist: [track],
      playbackAccountId: null,
      audioPermission: "unknown",
    });
  });

  it("preserves verified ownership and audio permission through same-account token refresh", async () => {
    expect(await play()).toBe(true);
    useAuthStore.setState({
      user: {
        id: "account-one",
        email: "user@example.com",
        name: null,
        picture: null,
      },
      accessToken: "new-token",
    });
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track,
      playbackAccountId: "account-one",
      audioPermission: "allowed",
    });
  });
});
