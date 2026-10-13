import type { DriveFile } from "@drivebeats/core/types";
import {
  consumeShuffleTrack,
  createShuffleCycle,
  reconcileShuffleCycle,
  restartShuffleCycle,
  type ShuffleCycle,
} from "./shuffle";

export interface PlaybackState {
  track: DriveFile | null;
  queue: DriveFile[];
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  loading: boolean;
  error: string | null;
}
export interface MediaReader {
  prepare(fileId: string): Promise<string>;
}

/** One audio element per runtime; tool results and view changes never replace it. */
export function createPlayer(audio: HTMLAudioElement, media: MediaReader) {
  let state: PlaybackState = {
    track: null,
    queue: [],
    playing: false,
    position: 0,
    duration: 0,
    volume: 1,
    shuffle: false,
    repeat: "off",
    loading: false,
    error: null,
  };
  let attempt = 0;
  let disposed = false;
  let cycle: ShuffleCycle | null = null;
  const listeners = new Set<() => void>();
  const history: string[] = [];
  let upcoming: DriveFile[] = [];
  let manualRevision = 0;
  let advanceListener: (() => void) | undefined;
  let manualListener: (() => void) | undefined;
  function update(changes: Partial<PlaybackState>) {
    if (disposed) return;
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }
  const events: [string, EventListener][] = [
    ["play", () => update({ playing: true, error: null })],
    ["pause", () => update({ playing: false })],
    [
      "timeupdate",
      () => {
        update({ position: audio.currentTime });
        advanceListener?.();
      },
    ],
    [
      "durationchange",
      () =>
        update({
          duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        }),
    ],
    [
      "error",
      () =>
        update({
          playing: false,
          loading: false,
          error:
            "This track is unavailable. Try Play again to renew its access, or choose another track.",
        }),
    ],
    [
      "ended",
      () => {
        if (state.repeat === "one") {
          audio.currentTime = 0;
          void resume();
        } else void next(false);
      },
    ],
  ];
  for (const [name, listener] of events) audio.addEventListener(name, listener);
  function manual() {
    manualRevision += 1;
    upcoming = [];
    manualListener?.();
  }
  async function resume() {
    if (disposed || !state.track) return false;
    const revision = attempt;
    try {
      await audio.play();
      return !disposed && revision === attempt;
    } catch {
      if (revision === attempt)
        update({
          playing: false,
          error: "Playback needs a tap. Select Play to continue.",
        });
      return false;
    }
  }
  async function play(file: DriveFile, queue?: DriveFile[], isManual = true) {
    if (disposed) return false;
    if (isManual) manual();
    const revision = ++attempt;
    audio.pause();
    const selectedQueue = queue
      ? [...new Map(queue.map((track) => [track.id, track])).values()]
      : state.queue;
    cycle = reconcileShuffleCycle(
      cycle,
      selectedQueue.map((track) => track.id),
      file.id,
    );
    update({
      track: file,
      queue: selectedQueue,
      position: 0,
      duration: 0,
      loading: true,
      error: null,
    });
    try {
      const url = await media.prepare(file.id);
      if (disposed || revision !== attempt) return false;
      audio.src = url;
      cycle = consumeShuffleTrack(
        cycle ??
          createShuffleCycle((queue ?? state.queue).map((track) => track.id)),
        file.id,
      );
      history.push(file.id);
      if (history.length > 50) history.shift();
      update({ loading: false });
      const started = await resume();
      advanceListener?.();
      return started;
    } catch (error) {
      if (revision === attempt)
        update({
          playing: false,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "This track could not be loaded.",
        });
      return false;
    }
  }
  async function next(isManual = true) {
    if (isManual) manual();
    const prepared = !isManual ? upcoming.shift() : undefined;
    if (prepared)
      return play(
        prepared,
        [
          ...state.queue,
          ...(state.queue.some((track) => track.id === prepared.id)
            ? []
            : [prepared]),
        ],
        false,
      );
    const ids = state.queue.map((track) => track.id);
    let nextId: string | undefined;
    if (state.shuffle) {
      if (!cycle) cycle = createShuffleCycle(ids, state.track?.id);
      if (!cycle.remainingIds.length && state.repeat === "all")
        cycle = restartShuffleCycle(ids, state.track?.id);
      nextId = cycle.remainingIds[0];
    } else {
      const index = state.queue.findIndex(
        (track) => track.id === state.track?.id,
      );
      nextId = ids[index + 1] ?? (state.repeat === "all" ? ids[0] : undefined);
    }
    const file = state.queue.find((track) => track.id === nextId);
    if (file) return play(file, undefined, false);
    audio.pause();
    update({ playing: false });
    return false;
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    play,
    async toggle() {
      manual();
      if (state.playing) {
        attempt += 1;
        audio.pause();
        update({ loading: false });
        return true;
      }
      if (!state.track) return false;
      return audio.error || !audio.src
        ? play(state.track, undefined, false)
        : resume();
    },
    pause() {
      manual();
      attempt += 1;
      audio.pause();
      update({ playing: false, loading: false });
    },
    next,
    async previous() {
      manual();
      if (audio.currentTime > 3) {
        audio.currentTime = 0;
        update({ position: 0 });
        return true;
      }
      const index = state.queue.findIndex(
        (track) => track.id === state.track?.id,
      );
      const file = state.queue[Math.max(0, index - 1)];
      return file ? play(file, undefined, false) : false;
    },
    seek(position: number) {
      if (Number.isFinite(position)) {
        audio.currentTime = Math.max(0, Math.min(state.duration, position));
        update({ position: audio.currentTime });
      }
    },
    setVolume(volume: number) {
      if (Number.isFinite(volume)) {
        audio.volume = Math.max(0, Math.min(1, volume));
        update({ volume: audio.volume });
      }
    },
    setShuffle(shuffle: boolean) {
      manual();
      cycle = createShuffleCycle(
        state.queue.map((track) => track.id),
        state.track?.id,
      );
      update({ shuffle });
    },
    setRepeat(repeat: PlaybackState["repeat"]) {
      update({ repeat });
    },
    queue(tracks: DriveFile[], mode: "append" | "replace") {
      manual();
      const queue = [
        ...new Map(
          (mode === "replace" ? tracks : [...state.queue, ...tracks]).map(
            (track) => [track.id, track],
          ),
        ).values(),
      ];
      cycle =
        mode === "append"
          ? reconcileShuffleCycle(
              cycle,
              queue.map((track) => track.id),
              state.track?.id,
            )
          : createShuffleCycle(
              queue.map((track) => track.id),
              state.track?.id,
            );
      update({ queue });
    },
    setUpcoming(tracks: DriveFile[], revision: number) {
      if (!disposed && revision === manualRevision) upcoming = tracks;
    },
    getManualRevision: () => manualRevision,
    getRecentIds: () => [...history],
    getUpcoming: () => [...upcoming],
    onManual(listener: (() => void) | undefined) {
      manualListener = listener;
    },
    onAdvance(listener: (() => void) | undefined) {
      advanceListener = listener;
    },
    reset() {
      manual();
      attempt += 1;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      cycle = null;
      history.length = 0;
      update({
        track: null,
        queue: [],
        playing: false,
        position: 0,
        duration: 0,
        loading: false,
        error: null,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      attempt += 1;
      audio.pause();
      audio.removeAttribute("src");
      for (const [name, listener] of events)
        audio.removeEventListener(name, listener);
      listeners.clear();
      advanceListener = undefined;
      manualListener = undefined;
    },
  };
}
export type PlayerRuntime = ReturnType<typeof createPlayer>;
