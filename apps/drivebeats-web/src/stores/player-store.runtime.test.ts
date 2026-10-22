import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeKey = Symbol.for("drivebeats.player-runtime");
class AudioFake extends EventTarget {
  paused = true;
  src = "";
  currentTime = 0;
  duration = 0;
  volume = 1;
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.paused = false;
  });
}
const track = { id: "current", name: "Current.mp3", mimeType: "audio/mpeg" };
async function createRuntime() {
  vi.resetModules();
  const { usePlayerStore } = await import("./player-store");
  return usePlayerStore;
}
afterEach(() => {
  const owner = Reflect.get(window, runtimeKey) as
    | { dispose(): void }
    | undefined;
  owner?.dispose();
  Reflect.deleteProperty(window, runtimeKey);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("player module ownership during Fast Refresh", () => {
  it("stops the previous detached audio and preserves listening context for the new controls", async () => {
    vi.stubGlobal("Audio", AudioFake);
    const first = await createRuntime();
    const oldAudio = first.getState().initAudio() as unknown as AudioFake;
    oldAudio.src = "blob:old";
    first.setState({ currentTrack: track, playlist: [track], currentIndex: 0 });
    expect(await first.getState().play()).toBe(true);
    expect(oldAudio.paused).toBe(false);
    const second = await createRuntime();
    expect(oldAudio.pause).toHaveBeenCalled();
    expect(oldAudio.paused).toBe(true);
    expect(oldAudio.src).toBe("");
    expect(second.getState()).toMatchObject({
      audio: null,
      isPlaying: false,
      currentTrack: track,
      playlist: [track],
    });
    const currentAudio = second.getState().initAudio() as unknown as AudioFake;
    expect(currentAudio).not.toBe(oldAudio);
    const persisted = localStorage.getItem("drivebeats-player");
    first.getState().setCurrentTime(99);
    first.getState().setIsPlaying(true);
    expect(await first.getState().play()).toBe(false);
    expect(localStorage.getItem("drivebeats-player")).toBe(persisted);
    currentAudio.src = "blob:current";
    expect(await second.getState().play()).toBe(true);
    second.getState().pause();
    expect(currentAudio.paused).toBe(true);
    expect(second.getState().isPlaying).toBe(false);
  });

  it("stops a stale play promise that resolves after its runtime was replaced", async () => {
    vi.stubGlobal("Audio", AudioFake);
    const first = await createRuntime();
    const oldAudio = first.getState().initAudio() as unknown as AudioFake;
    oldAudio.src = "blob:old";
    first.setState({ currentTrack: track, playlist: [track], currentIndex: 0 });
    let release!: () => void;
    oldAudio.play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            oldAudio.paused = false;
            resolve();
          };
        }),
    );
    const pending = first.getState().play();
    const second = await createRuntime();
    release();
    expect(await pending).toBe(false);
    expect(oldAudio.paused).toBe(true);
    expect(second.getState()).toMatchObject({
      audio: null,
      isPlaying: false,
      lastPlaybackFailure: null,
    });
  });
});
