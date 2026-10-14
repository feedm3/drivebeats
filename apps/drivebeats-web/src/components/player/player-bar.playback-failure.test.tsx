import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadGoogleDriveFileMedia } from "@/lib/google-api";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";
import { PlayerBar } from "./player-bar";

vi.mock("@/lib/google-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-api")>()),
  downloadGoogleDriveFileMedia: vi.fn(),
}));
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: Object.assign(
    (selector: (state: { cache: Record<string, unknown> }) => unknown) =>
      selector({ cache: {} }),
    { getState: () => ({ requestMetadata: vi.fn() }) },
  ),
}));
vi.mock("@/components/add-to-playlist-popover", () => ({
  AddToPlaylistPopover: () => null,
}));
vi.mock("@/components/favorite-toggle-button", () => ({
  FavoriteToggleButton: () => null,
}));
vi.mock("./play-controls", () => ({ PlayControls: () => null }));
vi.mock("./progress-bar", () => ({ ProgressBar: () => null }));
vi.mock("./track-info", () => ({ TrackInfo: () => null }));
vi.mock("./volume-control", () => ({ VolumeControl: () => null }));
vi.mock("./playback-queue-popover", () => ({
  PlaybackQueuePopover: () => null,
}));

const initialPlayer = usePlayerStore.getState();
const initialAuth = useAuthStore.getState();
const track: DriveFile = {
  id: "selected",
  name: "Selected.mp3",
  mimeType: "audio/mpeg",
};
let audio: HTMLAudioElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = vi.fn();
    },
  );
  useAuthStore.setState({
    ...initialAuth,
    user: {
      id: "account-one",
      email: "user@example.com",
      name: null,
      picture: null,
    },
    authStatus: "authenticated",
  });
  audio = document.createElement("audio");
  Object.defineProperty(audio, "paused", { value: true, writable: true });
  vi.spyOn(audio, "pause").mockImplementation(() => {
    Object.defineProperty(audio, "paused", { value: true, writable: true });
  });
  vi.spyOn(audio, "load").mockImplementation(() => undefined);
  usePlayerStore.setState({
    ...initialPlayer,
    audio,
    currentTrack: null,
    blobCache: new Map([[track.id, "blob:selected"]]),
    playlist: [],
    prefetchNextTrack: vi.fn(),
    lastPlaybackFailure: null,
    audioPermission: "unknown",
    playbackAccountId: null,
  });
});
afterEach(() => {
  cleanup();
  usePlayerStore.setState({ audio: null });
  usePlayerStore.getState().resetPlayback();
  useAuthStore.setState(initialAuth);
  usePlayerStore.setState(initialPlayer);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("actual player bar media events", () => {
  it.each([3, 4])(
    "keeps media error code%s terminal when the event precedes play rejection",
    async (code) => {
      render(<PlayerBar />);
      const started = Promise.withResolvers<void>();
      vi.spyOn(audio, "play").mockReturnValueOnce(started.promise);
      let playing!: Promise<boolean>;
      act(() => {
        playing = usePlayerStore.getState().playTrack(track, [track], []);
      });
      await act(async () => {
        Object.defineProperty(audio, "error", {
          configurable: true,
          value: { code },
        });
        audio.dispatchEvent(new Event("error"));
        started.reject(
          new DOMException("Cannot decode selected audio", "NotSupportedError"),
        );
        expect(await playing).toBe(false);
      });
      expect(usePlayerStore.getState()).toMatchObject({
        lastPlaybackFailure: { code: "unsupported_audio" },
        pendingTrackId: null,
        isPlaying: false,
        audioPermission: "unknown",
      });
      expect(audio.play).toHaveBeenCalledOnce();
      expect(downloadGoogleDriveFileMedia).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().blobCache.has(track.id)).toBe(true);
    },
  );

  it("lets a late background resume finish after timeout and clears the failure on actual playing", async () => {
    audio.src = "blob:selected";
    usePlayerStore.setState({
      currentTrack: track,
      playlist: [track],
      playbackAccountId: "account-one",
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.spyOn(audio, "play").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            Object.defineProperty(audio, "paused", {
              value: false,
              writable: true,
            });
            audio.dispatchEvent(new Event("playing"));
            resolve();
          }, 2000);
        }),
    );
    render(<PlayerBar />);
    let resumed!: Promise<boolean>;
    act(() => {
      resumed = usePlayerStore.getState().play();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(await resumed).toBe(false);
    expect(usePlayerStore.getState().lastPlaybackFailure?.code).toBe(
      "playback_timeout",
    );
    expect(audio.pause).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(audio.paused).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({
      isPlaying: true,
      audioPermission: "allowed",
      lastPlaybackFailure: null,
    });
  });
});
