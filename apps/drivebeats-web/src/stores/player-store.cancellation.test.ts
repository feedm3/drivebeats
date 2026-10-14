import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as offlineDb from "@/lib/offline-db";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

vi.mock("@/lib/offline-db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/offline-db")>();
  return {
    ...original,
    getTrack: vi.fn(),
  };
});

const track: DriveFile = {
  id: "selected",
  name: "Selected.mp3",
  mimeType: "audio/mpeg",
};
const initialPlayer = usePlayerStore.getState();
const initialAuth = useAuthStore.getState();

function playerAudio() {
  const audio = document.createElement("audio");
  audio.src = "blob:selected";
  audio.currentTime = 120;
  Object.defineProperty(audio, "paused", { value: true, writable: true });
  vi.spyOn(audio, "pause").mockImplementation(() => {
    Object.defineProperty(audio, "paused", { value: true, writable: true });
  });
  vi.spyOn(audio, "load").mockImplementation(() => undefined);
  usePlayerStore.setState({ audio });
  return audio;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  usePlayerStore.setState({
    ...initialPlayer,
    currentTrack: track,
    playlist: [track],
    currentIndex: 0,
    currentTime: 120,
    blobCache: new Map(),
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
  usePlayerStore.setState({ audio: null });
  usePlayerStore.getState().resetPlayback();
  usePlayerStore.setState(initialPlayer);
  useAuthStore.setState(initialAuth);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("real player request cancellation", () => {
  it("does not enter iOS recovery after a cancelled initial play attempt", async () => {
    const audio = playerAudio();
    const first = Promise.withResolvers<void>();
    const play = vi
      .spyOn(audio, "play")
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => {
        Object.defineProperty(audio, "paused", {
          value: false,
          writable: true,
        });
      });
    vi.mocked(audio.load).mockImplementation(() => {
      void Promise.resolve().then(() =>
        audio.dispatchEvent(new Event("loadedmetadata")),
      );
    });
    const playing = usePlayerStore.getState().play();
    usePlayerStore.getState().cancelPlaybackRequest();
    first.reject(new DOMException("Cancelled", "AbortError"));
    expect(await playing).toBe(false);
    expect(play).toHaveBeenCalledOnce();
    expect(audio.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack).toBe(track);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("does not restart audio when cancelled during iOS metadata recovery", async () => {
    const audio = playerAudio();
    const recovering = Promise.withResolvers<void>();
    const play = vi
      .spyOn(audio, "play")
      .mockRejectedValueOnce(new Error("Initial play blocked"))
      .mockImplementation(async () => {
        Object.defineProperty(audio, "paused", {
          value: false,
          writable: true,
        });
      });
    vi.mocked(audio.load).mockImplementation(() => recovering.resolve());
    const playing = usePlayerStore.getState().play();
    await recovering.promise;
    usePlayerStore.getState().cancelPlaybackRequest();
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(await playing).toBe(false);
    expect(play).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().playlist).toEqual([track]);
  });

  it("stays idle after an offline lookup finishes for a cancelled load", async () => {
    playerAudio();
    const lookup = Promise.withResolvers<undefined>();
    vi.mocked(offlineDb.getTrack).mockReturnValue(lookup.promise);
    const getToken = vi.fn(async () => null);
    useAuthStore.setState({ getValidAccessToken: getToken });
    const loading = usePlayerStore.getState().loadTrack(track.id);
    usePlayerStore.getState().cancelPlaybackRequest();
    lookup.resolve(undefined);
    expect(await loading).toBe(false);
    expect(usePlayerStore.getState().isLoading).toBe(false);
    expect(getToken).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playlist).toEqual([track]);
  });
});
