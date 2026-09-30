import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile, FolderEntry } from "@/types";

const tracks: DriveFile[] = ["a", "b", "c", "d"].map((id) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
}));
const folder: FolderEntry[] = [{ id: "music", name: "Music" }];
const originalLoadTrack = usePlayerStore.getState().loadTrack;
const originalInitAudio = usePlayerStore.getState().initAudio;

function currentId() {
  return usePlayerStore.getState().currentTrack?.id;
}

async function startShuffle(playlist = tracks, playlistId?: string) {
  await usePlayerStore
    .getState()
    .playTrack(playlist[0], playlist, folder, playlistId);
  usePlayerStore.getState().toggleShuffle();
  await Promise.resolve();
}

describe("shuffle playback cycles", () => {
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
      loadTrack: vi.fn(async (_fileId, _autoplay, beforeApply) => {
        beforeApply?.();
        return true;
      }),
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(async () => {
    await Promise.resolve();
    usePlayerStore.setState({ audio: null });
    usePlayerStore.getState().resetPlayback();
    usePlayerStore.setState({
      loadTrack: originalLoadTrack,
      initAudio: originalInitAudio,
    });
    vi.restoreAllMocks();
  });

  it("plays every track once even when Next deliberately skips tracks", async () => {
    await startShuffle();
    const played = [currentId()];
    for (let index = 1; index < tracks.length; index++) {
      await usePlayerStore.getState().next();
      played.push(currentId());
    }

    expect(new Set(played)).toEqual(new Set(tracks.map((track) => track.id)));
    const lastId = currentId();
    await usePlayerStore.getState().next();
    expect(currentId()).toBe(lastId);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("starts full new cycles with Repeat all without repeating at the boundary", async () => {
    await startShuffle();
    usePlayerStore.setState({ repeat: "all" });
    const played = [currentId()];
    for (let index = 1; index < tracks.length * 3; index++) {
      await usePlayerStore.getState().next();
      played.push(currentId());
    }

    for (let offset = 0; offset < played.length; offset += tracks.length) {
      expect(new Set(played.slice(offset, offset + tracks.length))).toEqual(
        new Set(tracks.map((track) => track.id)),
      );
      if (offset > 0) expect(played[offset]).not.toBe(played[offset - 1]);
    }
  });

  it("prefetches the same next track without consuming it", async () => {
    await startShuffle();
    const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
    const history = [...usePlayerStore.getState().shuffleHistory];
    usePlayerStore.getState().prefetchNextTrack();
    const nextId = usePlayerStore.getState().nextShuffleFileId;
    expect(nextId).toBeTruthy();
    for (let index = 0; index < 5; index++) {
      usePlayerStore.getState().prefetchNextTrack();
    }

    expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
    expect(usePlayerStore.getState().shuffleHistory).toEqual(history);
    expect(usePlayerStore.getState().nextShuffleFileId).toBe(nextId);
    await usePlayerStore.getState().next();
    expect(currentId()).toBe(nextId);
  });

  it.each([undefined, "playlist-one"])(
    "preserves a cycle when the same collection supplies a new track array (%s)",
    async (playlistId) => {
      await startShuffle(tracks, playlistId);
      await usePlayerStore.getState().next();
      const consumedId = currentId();
      const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
      expect(cycle?.remainingIds).toHaveLength(2);
      await usePlayerStore
        .getState()
        .playTrack(tracks[0], [...tracks], [...folder], playlistId);

      expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
      const remaining = cycle?.remainingIds.length ?? 0;
      const laterIds: (string | undefined)[] = [];
      for (let index = 0; index < remaining; index++) {
        await usePlayerStore.getState().next();
        laterIds.push(currentId());
      }
      expect(laterIds).not.toContain("a");
      expect(laterIds).not.toContain(consumedId);
    },
  );

  it.each(["folder", "playlist"])(
    "starts a fresh cycle when switching %s context with identical tracks",
    async (kind) => {
      await startShuffle(
        tracks,
        kind === "playlist" ? "playlist-one" : undefined,
      );
      await usePlayerStore.getState().next();
      const firstCycleTrack = currentId();
      await usePlayerStore
        .getState()
        .playTrack(
          tracks[0],
          [...tracks],
          [{ id: "other-folder", name: "Other" }],
          kind === "playlist" ? "playlist-two" : undefined,
        );

      expect(usePlayerStore.getState().shuffleHistory).toEqual([]);
      const played = [currentId()];
      for (let index = 1; index < tracks.length; index++) {
        await usePlayerStore.getState().next();
        played.push(currentId());
      }
      expect(played).toContain(firstCycleTrack);
      expect(new Set(played)).toEqual(new Set(tracks.map((track) => track.id)));
    },
  );

  it("preserves a library-search cycle as playback moves across folder paths", async () => {
    const paths = tracks.map((track) => [
      { id: `folder-${track.id}`, name: `Folder ${track.id}` },
    ]);
    await usePlayerStore
      .getState()
      .playTrack(tracks[0], tracks, paths[0], undefined, paths);
    usePlayerStore.getState().toggleShuffle();
    const played = [currentId()];
    for (let index = 1; index < tracks.length; index++) {
      await usePlayerStore.getState().next();
      played.push(currentId());
      const currentIndex = tracks.findIndex(
        (track) => track.id === currentId(),
      );
      expect(usePlayerStore.getState().playingFolderStack).toEqual(
        paths[currentIndex],
      );
    }
    expect(new Set(played)).toEqual(new Set(tracks.map((track) => track.id)));
    await usePlayerStore.getState().next();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("consumes a manually selected unplayed track without restarting the cycle", async () => {
    await startShuffle(tracks, "playlist-one");
    await usePlayerStore.getState().next();
    const consumedId = currentId();
    const selectedId = usePlayerStore.getState().shuffleCycle?.remainingIds[1];
    const selected = tracks.find((track) => track.id === selectedId);
    expect(selected).toBeDefined();
    if (!selected) throw new Error("Expected an unplayed track to select");
    await usePlayerStore
      .getState()
      .playTrack(selected, [...tracks], folder, "playlist-one");
    const remaining =
      usePlayerStore.getState().shuffleCycle?.remainingIds.length ?? 0;
    const laterIds: (string | undefined)[] = [];
    for (let index = 0; index < remaining; index++) {
      await usePlayerStore.getState().next();
      laterIds.push(currentId());
    }

    expect(laterIds).not.toContain("a");
    expect(laterIds).not.toContain(consumedId);
    expect(laterIds).not.toContain(selectedId);
    expect(laterIds).toHaveLength(1);
  });

  it("includes added tracks and removes deleted tracks from the current cycle", async () => {
    await startShuffle(tracks, "playlist-one");
    await usePlayerStore.getState().next();
    const consumedId = currentId();
    const removedId = usePlayerStore.getState().shuffleCycle?.remainingIds[0];
    expect(removedId).toBeDefined();
    const added: DriveFile = {
      id: "added",
      name: "Added.mp3",
      mimeType: "audio/mpeg",
    };
    usePlayerStore.getState().blobCache.set(added.id, "/media/added");
    const updated = [
      ...tracks.filter((track) => track.id !== removedId),
      added,
    ];
    await usePlayerStore
      .getState()
      .playTrack(tracks[0], updated, folder, "playlist-one");
    const played: (string | undefined)[] = [];
    const remaining =
      usePlayerStore.getState().shuffleCycle?.remainingIds.length ?? 0;
    for (let index = 0; index < remaining; index++) {
      await usePlayerStore.getState().next();
      played.push(currentId());
    }

    expect(played).toContain(added.id);
    expect(played).not.toContain(removedId);
    expect(played).not.toContain(consumedId);
    expect(played).not.toContain("a");
    expect(new Set(played).size).toBe(played.length);
  });

  it("lets Previous intentionally replay without returning tracks to the cycle", async () => {
    await startShuffle();
    await usePlayerStore.getState().next();
    const previousId = currentId();
    await usePlayerStore.getState().next();
    const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
    await usePlayerStore.getState().previous();

    expect(currentId()).toBe(previousId);
    expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
    await usePlayerStore.getState().next();
    expect(cycle?.remainingIds).toContain(currentId());
    await usePlayerStore.getState().next();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("rewinds valid history after a played track is deleted and the playlist reordered", async () => {
    await startShuffle(tracks, "playlist-one");
    await usePlayerStore.getState().next();
    const deletedId = currentId();
    await usePlayerStore.getState().next();
    const current = usePlayerStore.getState().currentTrack;
    const unplayedId = usePlayerStore.getState().shuffleCycle?.remainingIds[0];
    const unplayed = tracks.find((track) => track.id === unplayedId);
    expect(deletedId).not.toBe("a");
    if (!current || !unplayed)
      throw new Error("Expected played and unplayed tracks");
    await usePlayerStore
      .getState()
      .playTrack(
        current,
        [unplayed, current, tracks[0]],
        folder,
        "playlist-one",
      );
    await usePlayerStore.getState().previous();

    expect(currentId()).toBe("a");
    expect(usePlayerStore.getState().shuffleHistory).not.toContain(deletedId);
    expect(usePlayerStore.getState().shuffleCycle?.remainingIds).toEqual([
      unplayedId,
    ]);
  });

  it.each(["failed", "aborted"])(
    "keeps the next track and history after a %s load",
    async (outcome) => {
      await startShuffle();
      const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
      const history = [...usePlayerStore.getState().shuffleHistory];
      const nextId = usePlayerStore.getState().nextShuffleFileId;
      const loadTrack = vi.mocked(usePlayerStore.getState().loadTrack);
      if (outcome === "failed") {
        loadTrack.mockRejectedValueOnce(new Error("Media unavailable"));
      } else {
        loadTrack.mockResolvedValueOnce(false);
      }
      await usePlayerStore.getState().next();

      expect(currentId()).toBe("a");
      expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
      expect(usePlayerStore.getState().shuffleHistory).toEqual(history);
      expect(usePlayerStore.getState().pendingTrackId).toBeNull();
      await usePlayerStore.getState().next();
      expect(currentId()).toBe(nextId);
    },
  );

  it("does not consume the queued track if autoplay rejects after source application", async () => {
    await startShuffle();
    const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
    const history = [...usePlayerStore.getState().shuffleHistory];
    const nextId = usePlayerStore.getState().nextShuffleFileId;
    vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
      async (_fileId, _autoplay, beforeApply) => {
        beforeApply?.();
        throw new Error("Autoplay rejected");
      },
    );
    await usePlayerStore.getState().next();

    expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
    expect(usePlayerStore.getState().shuffleHistory).toEqual(history);
    expect(usePlayerStore.getState().pendingTrackId).toBeNull();
    await usePlayerStore.getState().next();
    expect(currentId()).toBe(nextId);
    expect(usePlayerStore.getState().shuffleCycle?.remainingIds).not.toContain(
      nextId,
    );
    await usePlayerStore.getState().previous();
    expect(currentId()).toBe("a");
  });

  it("consumes a rejected autoplay target after Play succeeds and retains its prior song", async () => {
    await startShuffle();
    const target = usePlayerStore.getState().nextShuffleFileId;
    vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
      async (_fileId, _autoplay, beforeApply) => {
        beforeApply?.();
        throw new Error("Autoplay rejected");
      },
    );
    await usePlayerStore.getState().next();
    expect(usePlayerStore.getState().shuffleCycle?.remainingIds).toContain(
      target,
    );
    const audio = usePlayerStore.getState().audio;
    if (!audio) throw new Error("Expected player audio");
    Object.assign(audio, {
      src: `/media/${target}`,
      paused: false,
      play: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(await usePlayerStore.getState().play()).toBe(true);
      expect(currentId()).toBe(target);
      expect(
        usePlayerStore.getState().shuffleCycle?.remainingIds,
      ).not.toContain(target);
      expect(usePlayerStore.getState().shuffleHistory).toEqual(["a"]);
      await usePlayerStore.getState().previous();
      expect(currentId()).toBe("a");
      await usePlayerStore.getState().next();
      expect(currentId()).not.toBe(target);
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it("does not consume a failed new track when an earlier Play promise completes", async () => {
    await startShuffle();
    const audio = usePlayerStore.getState().audio;
    if (!audio) throw new Error("Expected player audio");
    let finishEarlierPlay: (() => void) | undefined;
    Object.assign(audio, {
      src: "/media/a",
      paused: false,
      play: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishEarlierPlay = resolve;
          }),
      ),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const earlierPlay = usePlayerStore.getState().play();
      vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
        async (_fileId, _autoplay, beforeApply) => {
          beforeApply?.();
          throw new Error("New track autoplay rejected");
        },
      );
      await usePlayerStore.getState().playTrack(tracks[1], tracks, folder);
      const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
      const history = [...usePlayerStore.getState().shuffleHistory];
      finishEarlierPlay?.();
      expect(await earlierPlay).toBe(true);

      expect(currentId()).toBe("b");
      expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
      expect(usePlayerStore.getState().shuffleCycle?.remainingIds).toContain(
        "b",
      );
      expect(usePlayerStore.getState().shuffleHistory).toEqual(history);
      expect(history).toEqual([]);
    } finally {
      finishEarlierPlay?.();
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it("keeps Previous history when replay loading fails", async () => {
    await startShuffle();
    await usePlayerStore.getState().next();
    const current = currentId();
    const history = [...usePlayerStore.getState().shuffleHistory];
    vi.mocked(usePlayerStore.getState().loadTrack).mockResolvedValueOnce(false);
    await usePlayerStore.getState().previous();

    expect(currentId()).toBe(current);
    expect(usePlayerStore.getState().shuffleHistory).toEqual(history);
    await usePlayerStore.getState().previous();
    expect(currentId()).toBe("a");
  });

  it("ignores rapid Next presses while a track is loading", async () => {
    await startShuffle();
    const nextId = usePlayerStore.getState().nextShuffleFileId;
    let finishLoad: (() => void) | undefined;
    const loadTrack = vi.mocked(usePlayerStore.getState().loadTrack);
    loadTrack.mockImplementationOnce(
      (_fileId, _autoplay, beforeApply) =>
        new Promise<boolean>((resolve) => {
          finishLoad = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const callsBefore = loadTrack.mock.calls.length;
    const pending = usePlayerStore.getState().next();
    await usePlayerStore.getState().next();
    await usePlayerStore.getState().next();
    const navigationLoads = loadTrack.mock.calls.length - callsBefore;
    finishLoad?.();
    await pending;

    expect(navigationLoads).toBe(1);
    expect(currentId()).toBe(nextId);
    expect(usePlayerStore.getState().shuffleHistory).toEqual(["a"]);
  });

  it("keeps shuffle disabled when an earlier Next load finishes", async () => {
    await startShuffle();
    let finishLoad: (() => void) | undefined;
    vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
      (_fileId, _autoplay, beforeApply) =>
        new Promise<boolean>((resolve) => {
          finishLoad = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const pending = usePlayerStore.getState().next();
    usePlayerStore.getState().toggleShuffle();
    finishLoad?.();
    await pending;

    expect(usePlayerStore.getState().shuffle).toBe(false);
    expect(usePlayerStore.getState().shuffleCycle).toBeNull();
    expect(usePlayerStore.getState().shuffleHistory).toEqual([]);
  });

  it("preserves a newly enabled cycle when an older load finishes", async () => {
    await startShuffle();
    await usePlayerStore.getState().next();
    const current = currentId();
    const target = usePlayerStore.getState().nextShuffleFileId;
    let finishLoad: (() => void) | undefined;
    vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
      (_fileId, _autoplay, beforeApply) =>
        new Promise<boolean>((resolve) => {
          finishLoad = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const pending = usePlayerStore.getState().next();
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().toggleShuffle();
    finishLoad?.();
    await pending;

    const expected = tracks
      .map((track) => track.id)
      .filter((id) => id !== current && id !== target);
    expect(currentId()).toBe(target);
    expect(
      new Set(usePlayerStore.getState().shuffleCycle?.remainingIds),
    ).toEqual(new Set(expected));
  });

  it("consumes both tracks when shuffle is enabled during a manual track load", async () => {
    await usePlayerStore.getState().playTrack(tracks[0], tracks, folder);
    let finishLoad: (() => void) | undefined;
    vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
      (_fileId, _autoplay, beforeApply) =>
        new Promise<boolean>((resolve) => {
          finishLoad = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const pending = usePlayerStore
      .getState()
      .playTrack(tracks[1], tracks, folder);
    usePlayerStore.getState().toggleShuffle();
    finishLoad?.();
    await pending;

    expect(
      new Set(usePlayerStore.getState().shuffleCycle?.remainingIds),
    ).toEqual(new Set(["c", "d"]));
  });

  it("ignores a stale Next completion after a manual collection switch", async () => {
    await startShuffle(tracks, "playlist-one");
    let finishLoad: (() => void) | undefined;
    vi.mocked(usePlayerStore.getState().loadTrack).mockImplementationOnce(
      (_fileId, _autoplay, beforeApply) =>
        new Promise<boolean>((resolve) => {
          finishLoad = () => {
            beforeApply?.();
            resolve(true);
          };
        }),
    );
    const pending = usePlayerStore.getState().next();
    await usePlayerStore
      .getState()
      .playTrack(tracks[3], [...tracks], folder, "playlist-two");
    const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
    finishLoad?.();
    await pending;

    expect(currentId()).toBe("d");
    expect(usePlayerStore.getState().playingPlaylistId).toBe("playlist-two");
    expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
    expect(usePlayerStore.getState().shuffleHistory).toEqual([]);
  });

  it("starts a new playlist cycle even if its track array is reused", async () => {
    await startShuffle(tracks, "playlist-one");
    await usePlayerStore.getState().next();
    await usePlayerStore
      .getState()
      .playTrack(tracks[0], tracks, folder, "playlist-two");

    expect(usePlayerStore.getState().shuffleHistory).toEqual([]);
    expect(usePlayerStore.getState().shuffleCycle?.remainingIds).toHaveLength(
      3,
    );
  });

  it("persists cycle progress and Previous history across rehydration", async () => {
    await startShuffle();
    await usePlayerStore.getState().next();
    const current = currentId();
    const cycle = structuredClone(usePlayerStore.getState().shuffleCycle);
    const history = [...usePlayerStore.getState().shuffleHistory];
    const persisted = localStorage.getItem("drivebeats-player");
    expect(persisted).toBeTruthy();
    usePlayerStore.setState({
      currentTrack: null,
      shuffleCycle: null,
      shuffleHistory: [],
      nextShuffleFileId: null,
    });
    localStorage.setItem("drivebeats-player", persisted ?? "");
    await usePlayerStore.persist.rehydrate();
    await usePlayerStore.getState().restoreTrack();

    expect(currentId()).toBe(current);
    expect(usePlayerStore.getState().shuffleCycle).toEqual(cycle);
    expect(usePlayerStore.getState().shuffleHistory).toEqual(history);
    const rest: (string | undefined)[] = [];
    for (let index = 0; index < (cycle?.remainingIds.length ?? 0); index++) {
      await usePlayerStore.getState().next();
      rest.push(currentId());
    }
    expect(rest).not.toContain("a");
    expect(rest).not.toContain(current);
    expect(new Set(rest)).toEqual(new Set(cycle?.remainingIds));
  });

  it("initializes old saved shuffle state without replaying the restored track", async () => {
    localStorage.setItem(
      "drivebeats-player",
      JSON.stringify({
        state: {
          currentTrack: tracks[0],
          playlist: tracks,
          currentIndex: 0,
          playingFolderStack: folder,
          shuffle: true,
          repeat: "off",
        },
        version: 0,
      }),
    );
    await usePlayerStore.persist.rehydrate();
    await usePlayerStore.getState().restoreTrack();
    const played = [currentId()];
    for (let index = 1; index < tracks.length; index++) {
      await usePlayerStore.getState().next();
      played.push(currentId());
    }
    expect(new Set(played)).toEqual(new Set(tracks.map((track) => track.id)));
  });

  it("treats duplicate playlist entries as one song per cycle", async () => {
    await startShuffle([tracks[0], tracks[1], tracks[0], tracks[1]]);
    await usePlayerStore.getState().next();
    expect(currentId()).toBe("b");
    await usePlayerStore.getState().next();
    expect(currentId()).toBe("b");
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("stops a one-track collection with Repeat off and restarts with Repeat all", async () => {
    await startShuffle([tracks[0]]);
    const loadTrack = vi.mocked(usePlayerStore.getState().loadTrack);
    const callsBefore = loadTrack.mock.calls.length;
    await usePlayerStore.getState().next();
    expect(loadTrack.mock.calls.length).toBe(callsBefore);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    usePlayerStore.setState({ repeat: "all" });
    await usePlayerStore.getState().next();
    expect(loadTrack.mock.calls.length).toBe(callsBefore + 1);
    expect(currentId()).toBe("a");
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
});
