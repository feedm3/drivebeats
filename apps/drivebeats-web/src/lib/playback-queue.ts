import type { ShuffleCycle } from "@/lib/shuffle";
import type { DriveFile, FolderEntry } from "@/types";

export interface PlaybackQueueEntry {
  entryId: string;
  track: DriveFile;
  folderStack: FolderEntry[];
}

export interface PlaybackSequenceEntry extends PlaybackQueueEntry {
  sourceIndex: number | null;
}

export function createPlaybackSequence(
  playlist: DriveFile[],
  folderStacks: FolderEntry[][],
  currentIndex: number,
  shuffleCycle?: ShuffleCycle | null,
) {
  const sourceEntries = playlist.map((track, sourceIndex) => ({
    entryId: `source:${sourceIndex}:${track.id}`,
    track,
    folderStack: folderStacks[sourceIndex] ?? [],
    sourceIndex,
  }));
  if (!shuffleCycle)
    return { playbackSequence: sourceEntries, playbackCursor: currentIndex };
  const currentId = playlist[currentIndex]?.id;
  const ids = [
    ...new Set([
      ...shuffleCycle.playedIds.filter((id) => id !== currentId),
      ...(currentId ? [currentId] : []),
      ...shuffleCycle.remainingIds,
    ]),
  ];
  const playbackSequence = ids.flatMap((id) => {
    const entry = sourceEntries.find((item) => item.track.id === id);
    return entry ? [entry] : [];
  });
  return {
    playbackSequence,
    playbackCursor: playbackSequence.findIndex(
      (entry) => entry.sourceIndex === currentIndex,
    ),
  };
}

export function getPlaybackQueueTracks(state: {
  playbackSequence: PlaybackSequenceEntry[];
  playbackCursor: number;
}) {
  return state.playbackSequence.map((entry, index) => ({
    ...entry,
    status: (index < state.playbackCursor
      ? "played"
      : index === state.playbackCursor
        ? "current"
        : "upcoming") as "played" | "current" | "upcoming",
    removable: entry.sourceIndex === null && index > state.playbackCursor,
  }));
}

export interface UpcomingTrack {
  entryId: string | null;
  track: DriveFile;
  folderStack: FolderEntry[];
}

export function getUpcomingTracks(state: {
  playbackSequence?: PlaybackSequenceEntry[];
  playbackCursor?: number;
  queuedTracks: PlaybackQueueEntry[];
  playlist: DriveFile[];
  currentIndex: number;
  playingFolderStack: FolderEntry[];
  playlistFolderStacks: FolderEntry[][] | null;
  queuedPlaybackContext: {
    entryId: string;
    baseFolderStack: FolderEntry[];
  } | null;
  shuffle: boolean;
  shuffleCycle: ShuffleCycle | null;
  nextShuffleFileId?: string | null;
  repeat: "off" | "one" | "all";
}): UpcomingTrack[] {
  if (state.playbackSequence?.length)
    return state.playbackSequence
      .slice((state.playbackCursor ?? -1) + 1)
      .map((entry) => ({
        ...entry,
        entryId: entry.sourceIndex === null ? entry.entryId : null,
      }));
  const baseFolderStack =
    state.queuedPlaybackContext?.baseFolderStack ?? state.playingFolderStack;
  const continuation = state.shuffle
    ? (state.shuffleCycle?.remainingIds ?? []).flatMap((id) => {
        const index = state.playlist.findIndex((track) => track.id === id);
        return index < 0 ? [] : [index];
      })
    : state.playlist.flatMap((_track, index) =>
        index > state.currentIndex ? [index] : [],
      );
  if (
    state.shuffle &&
    continuation.length === 0 &&
    state.repeat === "all" &&
    state.nextShuffleFileId
  ) {
    const reservedIndex = state.playlist.findIndex(
      (track) => track.id === state.nextShuffleFileId,
    );
    if (reservedIndex >= 0) continuation.push(reservedIndex);
  }
  if (!state.shuffle && state.repeat === "all" && state.currentIndex >= 0)
    continuation.push(
      ...state.playlist.flatMap((_track, index) =>
        index <= state.currentIndex ? [index] : [],
      ),
    );
  return [
    ...state.queuedTracks.filter(
      (entry) => entry.entryId !== state.queuedPlaybackContext?.entryId,
    ),
    ...continuation.map((index) => ({
      entryId: null,
      track: state.playlist[index],
      folderStack: state.playlistFolderStacks?.[index] ?? baseFolderStack,
    })),
  ];
}
