import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackError } from "@/lib/playback-failure";
import { getUpcomingTracks } from "@/lib/playback-queue";
import { useAuthStore } from "@/stores/auth-store";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";

const tracks: DriveFile[] = ["a", "b", "c", "outside"].map((id) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
}));
const folder: FolderEntry[] = [{ id: "music", name: "Music" }];
const otherFolder: FolderEntry[] = [{ id: "other", name: "Other" }];
const originalLoadTrack = usePlayerStore.getState().loadTrack;
const originalInitAudio = usePlayerStore.getState().initAudio;
const originalUser = useAuthStore.getState().user;

function prepareAudio() {
  const audio = Object.assign(new EventTarget(), {
    src: "/media/current",
    currentTime: 0,
    paused: true,
    play: vi.fn(async () => {
      audio.paused = false;
    }),
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  });
  usePlayerStore.setState({ audio: audio as unknown as HTMLAudioElement });
  return audio;
}

describe("explicit Playback Queue", () => {
  beforeEach(() => {
    localStorage.clear();
    usePlayerStore.setState({ audio: null });
    usePlayerStore.getState().resetPlayback();
    const audio = {
      currentTime: 0,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLAudioElement;
    usePlayerStore.setState({
      audio,
      shuffle: false,
      repeat: "off",
      blobCache: new Map(
        tracks.map((track) => [track.id, `/media/${track.id}`]),
      ),
      initAudio: vi.fn(() => audio),
      loadTrack: vi.fn(async (_id, _autoplay, beforeApply) => {
        beforeApply?.();
        return true;
      }),
    });
  });

  afterEach(() => {
    useAuthStore.setState({ user: originalUser });
    usePlayerStore.setState({ audio: null });
    usePlayerStore.getState().resetPlayback();
    usePlayerStore.setState({
      loadTrack: originalLoadTrack,
      initAudio: originalInitAudio,
    });
    vi.restoreAllMocks();
  });

  it("inserts Play next ahead of appended tracks without restarting audio, then resumes its source", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(
      tracks[0],
      tracks.slice(0, 3),
      folder,
      "saved-playlist",
    );
    const load = vi.mocked(store().loadTrack);
    load.mockClear();
    store().queueTrack(tracks[3], "end", otherFolder);
    store().queueTrack(tracks[2], "next", folder);
    expect(load).not.toHaveBeenCalled();
    expect(getUpcomingTracks(store()).map((entry) => entry.track.id)).toEqual([
      "c",
      "outside",
      "b",
      "c",
    ]);
    await store().next();
    expect(store().currentTrack?.id).toBe("c");
    expect(store().currentIndex).toBe(0);
    await store().next();
    expect(store().currentTrack?.id).toBe("outside");
    expect(store().playingFolderStack).toEqual(otherFolder);
    expect(store().playingPlaylistId).toBe("saved-playlist");
    await store().next();
    expect(store().currentTrack?.id).toBe("b");
    expect(store().queuedPlaybackContext).toBeNull();
    expect(store().currentIndex).toBe(1);
  });

  it("plays duplicate queue occurrences individually even with shuffle enabled", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().toggleShuffle();
    const cycle = structuredClone(store().shuffleCycle);
    store().queueTrack(tracks[3], "end", otherFolder);
    store().queueTrack(tracks[3], "end", otherFolder);
    const ids = store().queuedTracks.map((entry) => entry.entryId);
    expect(new Set(ids).size).toBe(2);
    await store().next();
    expect(store().queuedTracks.map((entry) => entry.entryId)).toEqual([
      ids[1],
    ]);
    expect(store().shuffleCycle).toEqual(cycle);
    await store().next();
    expect(store().queuedTracks).toEqual([]);
    expect(store().shuffleCycle).toEqual(cycle);
    await store().next();
    expect(store().currentTrack?.id).toBe(cycle?.remainingIds[0]);
  });

  it("keeps failed queued playback available until successfully retried", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[3], "end", otherFolder);
    const entryId = store().queuedTracks[0].entryId;
    vi.mocked(store().loadTrack).mockImplementationOnce(
      async (_id, _autoplay, beforeApply) => {
        beforeApply?.();
        throw new DOMException("Play requires a gesture", "NotAllowedError");
      },
    );
    await store().next();
    expect(store().isPlaying).toBe(false);
    expect(store().queuedTracks[0].entryId).toBe(entryId);
    expect(getUpcomingTracks(store()).map((entry) => entry.track.id)).toEqual([
      "b",
      "c",
    ]);
    expect(store().currentIndex).toBe(0);
    prepareAudio();
    expect(await store().play()).toBe(true);
    expect(store().queuedTracks).toEqual([]);
    await store().next();
    expect(store().currentTrack?.id).toBe("b");
  });

  it.each([false, true])(
    "Next skips an applied permanently failed entry (new explicit next: %s)",
    async (hasNextAddition) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      store().queueTrack(tracks[3], "end", otherFolder);
      const failedEntryId = store().queuedTracks[0].entryId;
      vi.mocked(store().loadTrack).mockImplementationOnce(
        async (_id, _autoplay, beforeApply) => {
          beforeApply?.();
          throw new PlaybackError("unsupported_audio");
        },
      );
      await store().next();
      expect(store().queuedTracks[0].entryId).toBe(failedEntryId);
      if (hasNextAddition) store().queueTrack(tracks[2], "next", folder);
      await store().next();
      expect(store().currentTrack?.id).toBe(hasNextAddition ? "c" : "b");
      expect(store().queuedTracks).toEqual([]);
      if (hasNextAddition) {
        await store().next();
        expect(store().currentTrack?.id).toBe("b");
      }
    },
  );

  it("keeps a before-source failure visible and removable", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[3], "end", otherFolder);
    vi.mocked(store().loadTrack).mockRejectedValueOnce(
      new PlaybackError("network_error"),
    );
    await store().next();
    expect(store().currentTrack?.id).toBe("a");
    expect(getUpcomingTracks(store()).map((entry) => entry.track.id)).toEqual([
      "outside",
      "b",
      "c",
    ]);
    store().removeQueuedTrack(store().queuedTracks[0].entryId);
    expect(store().queuedTracks).toEqual([]);
  });

  it("starts an idle queue and persists remaining occurrences across reload", async () => {
    const store = usePlayerStore.getState;
    store().queueTrack(tracks[3], "end", otherFolder);
    store().queueTrack(tracks[3], "end", otherFolder);
    expect(await store().play()).toBe(true);
    const queued = structuredClone(store().queuedTracks);
    const context = structuredClone(store().queuedPlaybackContext);
    const persisted = localStorage.getItem("drivebeats-player");
    store().resetPlayback();
    localStorage.setItem("drivebeats-player", persisted ?? "");
    await usePlayerStore.persist.rehydrate();
    expect(store().queuedTracks).toEqual(queued);
    expect(store().queuedPlaybackContext).toEqual(context);
    await store().next();
    expect(store().queuedTracks).toEqual([]);
    await store().next();
    expect(store().isPlaying).toBe(false);
  });

  it.each([
    { action: "remove", applied: false },
    { action: "clear", applied: false },
    { action: "remove", applied: true },
    { action: "clear", applied: true },
  ])(
    "$action cancels only the pending queue source (applied: $applied)",
    async ({ action, applied }) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      const pause = vi.mocked(
        store().audio?.pause as HTMLAudioElement["pause"],
      );
      pause.mockClear();
      store().queueTrack(tracks[3], "end", otherFolder);
      const entryId = store().queuedTracks[0].entryId;
      let finish: (() => void) | undefined;
      vi.mocked(store().loadTrack).mockImplementationOnce(
        (_id, _autoplay, beforeApply) =>
          new Promise((resolve) => {
            if (applied) beforeApply?.();
            finish = () => {
              beforeApply?.();
              resolve(true);
            };
          }),
      );
      const navigation = store().next();
      expect(store().pendingTrackId).toBe("outside");
      if (action === "remove") store().removeQueuedTrack(entryId);
      else store().clearQueuedTracks();
      expect(store().pendingTrackId).toBeNull();
      expect(store().isLoading).toBe(false);
      expect(store().isPlaying).toBe(!applied);
      if (applied) expect(pause).toHaveBeenCalledOnce();
      else expect(pause).not.toHaveBeenCalled();
      finish?.();
      await navigation;
      expect(store().currentTrack?.id).toBe(applied ? "outside" : "a");
      expect(store().isPlaying).toBe(!applied);
      expect(store().queuedTracks).toEqual([]);
    },
  );

  it("clears account-owned queue occurrences on account change and logout", () => {
    const user = (id: string) => ({
      id,
      email: `${id}@example.com`,
      name: id,
      picture: null,
    });
    useAuthStore.setState({ user: user("first") });
    usePlayerStore.getState().queueTrack(tracks[3], "end", otherFolder);
    expect(usePlayerStore.getState().queuedAccountId).toBe("first");
    useAuthStore.setState({ user: user("second") });
    expect(usePlayerStore.getState().queuedTracks).toEqual([]);
    usePlayerStore.getState().queueTrack(tracks[3], "end", otherFolder);
    useAuthStore.setState({ user: null });
    expect(usePlayerStore.getState().queuedTracks).toEqual([]);
  });

  it("keeps downloading the first duplicate when a later occurrence is removed", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[3], "end", otherFolder);
    store().queueTrack(tracks[3], "end", otherFolder);
    const laterEntryId = store().queuedTracks[1].entryId;
    let finish: (() => void) | undefined;
    vi.mocked(store().loadTrack).mockImplementationOnce(
      (_id, _autoplay, beforeApply) =>
        new Promise((resolve) => {
          finish = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const navigation = store().next();
    store().removeQueuedTrack(laterEntryId);
    expect(store().pendingTrackId).toBe("outside");
    finish?.();
    await navigation;
    expect(store().currentTrack?.id).toBe("outside");
    expect(store().isPlaying).toBe(true);
    expect(store().queuedTracks).toEqual([]);
  });

  it("clears explicit additions without canceling a base-track download of the same file", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[1], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[0], "end", folder);
    let finish: (() => void) | undefined;
    vi.mocked(store().loadTrack).mockImplementationOnce(
      (_id, _autoplay, beforeApply) =>
        new Promise((resolve) => {
          finish = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const navigation = store().previous();
    expect(store().pendingTrackId).toBe("a");
    store().clearQueuedTracks();
    expect(store().pendingTrackId).toBe("a");
    finish?.();
    await navigation;
    expect(store().currentTrack?.id).toBe("a");
    expect(store().isPlaying).toBe(true);
    expect(store().queuedTracks).toEqual([]);
  });

  it("preserves explicit additions while Previous navigates its source", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[1], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[3], "end", otherFolder);
    const entries = structuredClone(store().queuedTracks);
    await store().previous();
    expect(store().currentTrack?.id).toBe("a");
    expect(store().queuedTracks).toEqual(entries);
    await store().next();
    expect(store().currentTrack?.id).toBe("outside");
  });

  it.each(["remove", "clear"])(
    "%s after superseding a queue download preserves an in-flight current-track resume",
    async (action) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      const audio = prepareAudio();
      store().queueTrack(tracks[3], "end", otherFolder);
      const entryId = store().queuedTracks[0].entryId;
      let finishDownload: (() => void) | undefined;
      vi.mocked(store().loadTrack).mockImplementationOnce(
        (_id, _autoplay, beforeApply) =>
          new Promise((resolve) => {
            finishDownload = () => {
              beforeApply?.();
              resolve(true);
            };
          }),
      );
      const next = store().next();
      expect(store().pendingTrackId).toBe("outside");
      let finishResume: (() => void) | undefined;
      audio.play.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishResume = () => {
              audio.paused = false;
              resolve();
            };
          }),
      );
      const resume = store().play();
      expect(store().pendingTrackId).toBeNull();
      if (action === "remove") store().removeQueuedTrack(entryId);
      else store().clearQueuedTracks();
      finishResume?.();
      expect(await resume).toBe(true);
      finishDownload?.();
      await next;
      expect(audio.pause).not.toHaveBeenCalled();
      expect(store().currentTrack?.id).toBe("a");
      expect(store().isPlaying).toBe(true);
      expect(store().queuedTracks).toEqual([]);
    },
  );

  it("projects the real shuffle order after explicit additions without changing the cycle", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().toggleShuffle();
    store().queueTrack(tracks[3], "end", otherFolder);
    const cycle = structuredClone(store().shuffleCycle);
    expect(getUpcomingTracks(store()).map((entry) => entry.track.id)).toEqual([
      "outside",
      ...(cycle?.remainingIds ?? []),
    ]);
    expect(store().shuffleCycle).toEqual(cycle);
  });
});
