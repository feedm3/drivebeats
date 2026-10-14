import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackError } from "@/lib/playback-failure";
import {
  getPlaybackQueueTracks,
  getUpcomingTracks,
} from "@/lib/playback-queue";
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
      "b",
      "c",
      "outside",
    ]);
    await store().next();
    expect(store().currentTrack?.id).toBe("c");
    expect(store().currentIndex).toBe(0);
    await store().next();
    expect(store().currentTrack?.id).toBe("b");
    expect(store().queuedPlaybackContext).toBeNull();
    expect(store().currentIndex).toBe(1);
    await store().next();
    expect(store().currentTrack?.id).toBe("c");
    await store().next();
    expect(store().currentTrack?.id).toBe("outside");
    expect(store().playingFolderStack).toEqual(otherFolder);
    expect(store().playingPlaylistId).toBe("saved-playlist");
  });

  it("plays duplicate queue occurrences individually even with shuffle enabled", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().toggleShuffle();
    const cycle = structuredClone(store().shuffleCycle);
    store().queueTrack(tracks[3], "next", otherFolder);
    store().queueTrack(tracks[3], "next", otherFolder);
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
    store().queueTrack(tracks[3], "next", otherFolder);
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
      store().queueTrack(tracks[3], "next", otherFolder);
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
    store().queueTrack(tracks[3], "next", otherFolder);
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
    "$action protects current rows and cancels future downloads (applied: $applied)",
    async ({ action, applied }) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      const pause = vi.mocked(
        store().audio?.pause as HTMLAudioElement["pause"],
      );
      pause.mockClear();
      store().queueTrack(tracks[3], "next", otherFolder);
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
      expect(store().pendingTrackId).toBe(applied ? "outside" : null);
      expect(store().isLoading).toBe(false);
      expect(store().isPlaying).toBe(true);
      expect(pause).not.toHaveBeenCalled();
      finish?.();
      await navigation;
      expect(store().currentTrack?.id).toBe(applied ? "outside" : "a");
      expect(store().isPlaying).toBe(true);
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
    store().queueTrack(tracks[3], "next", otherFolder);
    store().queueTrack(tracks[3], "next", otherFolder);
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
    store().queueTrack(tracks[3], "next", otherFolder);
    const entries = structuredClone(store().queuedTracks);
    await store().previous();
    expect(store().currentTrack?.id).toBe("a");
    expect(store().queuedTracks).toEqual(entries);
    await store().next();
    expect(store().currentTrack?.id).toBe("b");
    await store().next();
    expect(store().currentTrack?.id).toBe("outside");
  });

  it.each(["remove", "clear"])(
    "%s after superseding a queue download preserves an in-flight current-track resume",
    async (action) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      const audio = prepareAudio();
      store().queueTrack(tracks[3], "next", otherFolder);
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
      ...(cycle?.remainingIds ?? []),
      "outside",
    ]);
    expect(store().shuffleCycle).toEqual(cycle);
  });

  it("retains one ordered session while Previous, Next and row selection replay explicit occurrences", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[3], "next", otherFolder);
    store().queueTrack(tracks[3], "end", otherFolder);
    const sequence = store().playbackSequence;
    expect(sequence.map((entry) => entry.track.id)).toEqual([
      "a",
      "outside",
      "b",
      "c",
      "outside",
    ]);
    for (const id of ["outside", "b", "c", "outside"]) {
      await store().next();
      expect(store().currentTrack?.id).toBe(id);
      expect(store().playbackSequence).toBe(sequence);
    }
    expect(
      getPlaybackQueueTracks(store()).map((entry) => entry.status),
    ).toEqual(["played", "played", "played", "played", "current"]);
    await store().previous();
    expect(store().currentTrack?.id).toBe("c");
    await store().next();
    expect(store().playbackCursor).toBe(4);
    await store().playQueueEntry(sequence[1].entryId);
    expect(store().playbackCursor).toBe(1);
    expect(store().playingFolderStack).toEqual(otherFolder);
    await store().next();
    expect(store().currentTrack?.id).toBe("b");
    expect(store().playbackSequence).toBe(sequence);
  });

  it("removes only future additions and retains current and played rows", async () => {
    const store = usePlayerStore.getState;
    store().queueTrack(tracks[3], "end", otherFolder);
    store().queueTrack(tracks[3], "end", otherFolder);
    await store().next();
    await store().next();
    const entries = store().playbackSequence;
    store().removeQueuedTrack(entries[0].entryId);
    store().clearQueuedTracks();
    expect(store().playbackSequence).toBe(entries);
    await store().previous();
    store().clearQueuedTracks();
    expect(store().playbackSequence.map((entry) => entry.entryId)).toEqual([
      entries[0].entryId,
    ]);
    expect(store().playbackCursor).toBe(0);
  });

  it("preserves every future source track when shuffle changes after replaying an explicit row", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().queueTrack(tracks[3], "next", otherFolder);
    const explicitId = store().playbackSequence[1].entryId;
    await store().next();
    await store().next();
    await store().next();
    expect(store().currentIndex).toBe(2);
    await store().playQueueEntry(explicitId);
    store().toggleShuffle();
    expect(
      store()
        .playbackSequence.slice(0, 2)
        .map((entry) => entry.track.id),
    ).toEqual(["a", "outside"]);
    expect(
      new Set(
        store()
          .playbackSequence.slice(2)
          .map((entry) => entry.track.id),
      ),
    ).toEqual(new Set(["b", "c"]));
    expect(
      new Set(store().playbackSequence.map((entry) => entry.entryId)).size,
    ).toBe(4);
  });

  it("keeps the settled sequence and current row until a repeat-all shuffled source applies", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    store().toggleShuffle();
    await store().next();
    await store().next();
    store().cycleRepeat();
    store().cycleRepeat();
    const sequence = store().playbackSequence;
    const cursor = store().playbackCursor;
    const lastId = store().currentTrack?.id;
    let failDownload: (() => void) | undefined;
    vi.mocked(store().loadTrack).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failDownload = () => reject(new PlaybackError("network_error"));
        }),
    );
    const next = store().next();
    expect(store().playbackSequence).toBe(sequence);
    expect(store().playbackCursor).toBe(cursor);
    expect(sequence[cursor].track.id).toBe(lastId);
    failDownload?.();
    await next;
    expect(store().playbackSequence).toBe(sequence);
    expect(store().playbackSequence[store().playbackCursor].track.id).toBe(
      store().currentTrack?.id,
    );
    await store().next();
    expect(store().playbackCursor).toBe(0);
    expect(store().currentTrack?.id).not.toBe(lastId);
    expect(store().playbackSequence[0].track.id).toBe(store().currentTrack?.id);
  });

  it.each([false, true])(
    "migrates saved player state into a retained session (active explicit: %s)",
    async (activeExplicit) => {
      localStorage.setItem(
        "drivebeats-player",
        JSON.stringify({
          state: {
            currentTrack: activeExplicit ? tracks[3] : tracks[1],
            playlist: tracks.slice(0, 3),
            currentIndex: activeExplicit ? 0 : 1,
            playingFolderStack: activeExplicit ? otherFolder : folder,
            queuedPlaybackContext: activeExplicit
              ? { entryId: "old-explicit", baseFolderStack: folder }
              : null,
          },
          version: 0,
        }),
      );
      await usePlayerStore.persist.rehydrate();
      const store = usePlayerStore.getState;
      expect(store().playbackSequence.map((entry) => entry.track.id)).toEqual(
        activeExplicit ? ["a", "outside", "b", "c"] : ["a", "b", "c"],
      );
      expect(store().playbackSequence[store().playbackCursor].track).toEqual(
        store().currentTrack,
      );
      await store().next();
      expect(store().currentTrack?.id).toBe(activeExplicit ? "b" : "c");
    },
  );

  it.each(["next", "end"] as const)(
    "keeps %s additions made during a pending repeat-all shuffle transition",
    async (position) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      store().toggleShuffle();
      await store().next();
      await store().next();
      store().cycleRepeat();
      store().cycleRepeat();
      const previousSequence = store().playbackSequence;
      const previousCursor = store().playbackCursor;
      const pause = vi.mocked(
        store().audio?.pause as HTMLAudioElement["pause"],
      );
      pause.mockClear();
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
      const wrap = store().next();
      expect(store().pendingTrackId).not.toBeNull();
      store().queueTrack(tracks[3], position, otherFolder);
      const additionId = store().playbackSequence.at(-1)?.entryId;
      expect(store().pendingTrackId).toBeNull();
      finishDownload?.();
      await wrap;
      expect(store().playbackSequence.slice(0, -1)).toEqual(previousSequence);
      expect(store().playbackSequence.at(-1)?.entryId).toBe(additionId);
      expect(store().playbackCursor).toBe(previousCursor);
      expect(pause).not.toHaveBeenCalled();
      await store().next();
      expect(store().currentTrack?.id).toBe("outside");
      expect(store().playbackSequence[store().playbackCursor].entryId).toBe(
        additionId,
      );
    },
  );

  it.each(["source", "explicit", "row"])(
    "Play next cancels a pre-apply %s navigation and keeps the new addition first",
    async (kind) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      if (kind === "explicit") store().queueTrack(tracks[2], "next", folder);
      const pendingEntry =
        kind === "row"
          ? store().playbackSequence[2]
          : store().playbackSequence[1];
      const pause = vi.mocked(
        store().audio?.pause as HTMLAudioElement["pause"],
      );
      pause.mockClear();
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
      const pending =
        kind === "row"
          ? store().playQueueEntry(pendingEntry.entryId)
          : store().next();
      expect(store().pendingTrackId).toBe(pendingEntry.track.id);
      store().queueTrack(tracks[3], "next", otherFolder);
      const addedEntry = store().playbackSequence[1];
      finishDownload?.();
      await pending;
      expect(store().currentTrack?.id).toBe("a");
      expect(store().playbackCursor).toBe(0);
      expect(store().pendingTrackId).toBeNull();
      expect(pause).not.toHaveBeenCalled();
      expect(getPlaybackQueueTracks(store())[1].status).toBe("upcoming");
      expect(getPlaybackQueueTracks(store())[1].removable).toBe(true);
      await store().next();
      expect(store().currentTrack?.id).toBe("outside");
      expect(store().playbackSequence[store().playbackCursor].entryId).toBe(
        addedEntry.entryId,
      );
      await store().next();
      expect(store().playbackSequence[store().playbackCursor].entryId).toBe(
        kind === "row" ? "source:1:b" : pendingEntry.entryId,
      );
    },
  );

  it("Play next after source application preserves the active request and its failure diagnosis", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    let failAutoplay: (() => void) | undefined;
    vi.mocked(store().loadTrack).mockImplementationOnce(
      (_id, _autoplay, beforeApply) =>
        new Promise((_resolve, reject) => {
          beforeApply?.();
          failAutoplay = () =>
            reject(new PlaybackError("audio_user_interaction_required"));
        }),
    );
    const pending = store().next();
    expect(store().currentTrack?.id).toBe("b");
    store().queueTrack(tracks[3], "next", otherFolder);
    expect(store().pendingTrackId).toBe("b");
    failAutoplay?.();
    await pending;
    expect(store().isPlaying).toBe(false);
    expect(store().lastPlaybackFailure?.code).toBe(
      "audio_user_interaction_required",
    );
    expect(store().playbackSequence[store().playbackCursor + 1].track.id).toBe(
      "outside",
    );
    await store().next();
    expect(store().currentTrack?.id).toBe("outside");
  });

  it("round-trips compact source references with folder paths and explicit occurrence navigation", async () => {
    const store = usePlayerStore.getState;
    const deepFolder = [...folder, { id: "album", name: "Album" }];
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder, undefined, [
      folder,
      otherFolder,
      deepFolder,
    ]);
    store().queueTrack(tracks[3], "next", otherFolder);
    await store().next();
    await store().next();
    const sequenceIds = store().playbackSequence.map((entry) => entry.entryId);
    const saved = localStorage.getItem("drivebeats-player") ?? "";
    const persisted = JSON.parse(saved);
    expect(
      persisted.state.playbackSequence
        .filter(
          (entry: { sourceIndex: number | null }) => entry.sourceIndex !== null,
        )
        .every((entry: object) => !("track" in entry)),
    ).toBe(true);
    expect(
      persisted.state.playbackSequence.find(
        (entry: { sourceIndex: number | null }) => entry.sourceIndex === 2,
      ).folderStack,
    ).toEqual(deepFolder);
    store().resetPlayback();
    localStorage.setItem("drivebeats-player", saved);
    await usePlayerStore.persist.rehydrate();
    expect(store().playbackSequence.map((entry) => entry.entryId)).toEqual(
      sequenceIds,
    );
    expect(store().playbackSequence[store().playbackCursor].track.id).toBe("b");
    expect(store().playingFolderStack).toEqual(otherFolder);
    await store().previous();
    expect(store().currentTrack?.id).toBe("outside");
    expect(store().playingFolderStack).toEqual(otherFolder);
    await store().next();
    await store().next();
    expect(store().currentTrack?.id).toBe("c");
    expect(store().playingFolderStack).toEqual(deepFolder);
  });

  it.each([false, true])(
    "continues an ended track's interrupted advance after ordered Play next insertion (batch: %s)",
    async (batch) => {
      const store = usePlayerStore.getState;
      await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
      const audio = Object.assign(prepareAudio(), { ended: true });
      usePlayerStore.setState({ isPlaying: false });
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
      const originalAdvance = store().next();
      expect(store().pendingTrackId).toBe("b");
      if (batch) store().queueTrack(tracks[2], "next", folder);
      store().queueTrack(tracks[3], "next", otherFolder);
      const firstAdditionId = store().playbackSequence[1].entryId;
      expect(store().pendingTrackId).toBeNull();
      expect(store().currentTrack?.id).toBe("a");
      finishDownload?.();
      await originalAdvance;
      await Promise.resolve();
      expect(store().currentTrack?.id).toBe("outside");
      expect(store().playbackSequence[store().playbackCursor].entryId).toBe(
        firstAdditionId,
      );
      expect(store().isPlaying).toBe(true);
      expect(audio.pause).not.toHaveBeenCalled();
      await store().next();
      expect(store().currentTrack?.id).toBe(batch ? "c" : "b");
      if (batch) {
        await store().next();
        expect(store().currentTrack?.id).toBe("b");
      }
    },
  );

  it("puts Play next ahead of a pending sequential Repeat all wrap", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[2], tracks.slice(0, 3), folder);
    store().cycleRepeat();
    store().cycleRepeat();
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
    const wrap = store().next();
    expect(store().pendingTrackId).toBe("a");
    store().queueTrack(tracks[3], "next", otherFolder);
    finishDownload?.();
    await wrap;
    expect(store().currentTrack?.id).toBe("c");
    expect(store().pendingTrackId).toBeNull();
    await store().next();
    expect(store().currentTrack?.id).toBe("outside");
    await store().next();
    expect(store().currentTrack?.id).toBe("a");
  });

  it("does not continue a canceled ended-track advance after a newer reset", async () => {
    const store = usePlayerStore.getState;
    await store().playTrack(tracks[0], tracks.slice(0, 3), folder);
    Object.assign(prepareAudio(), { ended: true });
    usePlayerStore.setState({ isPlaying: false });
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
    const advance = store().next();
    store().queueTrack(tracks[3], "next", otherFolder);
    store().resetPlayback();
    finishDownload?.();
    await advance;
    await Promise.resolve();
    expect(store().currentTrack).toBeNull();
    expect(store().pendingTrackId).toBeNull();
    expect(store().isPlaying).toBe(false);
  });
});
