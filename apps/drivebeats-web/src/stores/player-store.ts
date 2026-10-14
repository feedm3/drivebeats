import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GoogleDriveReadError } from "@/lib/drive-read-error";
import { downloadGoogleDriveFileMedia } from "@/lib/google-api";
import * as offlineDb from "@/lib/offline-db";
import {
  cacheSessionMedia,
  deleteSessionMedia,
  getOfflineTrackUrl,
  isBlobUrl,
  isSessionMediaUrl,
} from "@/lib/offline-media";
import {
  getPlaybackFailure,
  PlaybackError,
  type PlaybackFailure,
} from "@/lib/playback-failure";
import {
  createPlaybackSequence,
  type PlaybackQueueEntry,
  type PlaybackSequenceEntry,
} from "@/lib/playback-queue";
import {
  consumeShuffleTrack,
  createShuffleCycle,
  reconcileShuffleCycle,
  restartShuffleCycle,
  type ShuffleCycle,
} from "@/lib/shuffle";
import { useAuthStore } from "@/stores/auth-store";
import { useFolderCacheStore } from "@/stores/folder-cache-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import { useLibraryStore } from "@/stores/library-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { DriveFile, FolderEntry } from "@/types";
import { FOLDER_MIME, INITIAL_STACK } from "@/types";

type RepeatMode = "off" | "one" | "all";

export function hasNextTrack(state: {
  currentIndex: number;
  playlist: { length: number };
  shuffle: boolean;
  repeat: RepeatMode;
  shuffleCycle?: ShuffleCycle | null;
  queuedTracks?: { length: number };
  playbackSequence?: { length: number };
  playbackCursor?: number;
}) {
  if (state.playbackSequence?.length)
    return (
      (state.playbackCursor ?? -1) < state.playbackSequence.length - 1 ||
      state.repeat === "all"
    );
  if (state.queuedTracks?.length) return true;
  if (state.playlist.length === 0) return false;
  if (state.shuffle) {
    return (
      state.repeat === "all" ||
      (state.shuffleCycle
        ? state.shuffleCycle.remainingIds.length > 0
        : state.playlist.length > 1 || state.currentIndex < 0)
    );
  }
  const isLastTrack = state.currentIndex >= state.playlist.length - 1;
  return !isLastTrack || state.repeat === "all";
}

const MAX_CACHE_SIZE = 20;
const PLAY_ATTEMPT_TIMEOUT_MS = 1500;
const FRESH_SOURCE_PLAY_TIMEOUT_MS = 10_000;

let fetchAbortController: AbortController | null = null;
let prefetchAbortController: AbortController | null = null;
let playTrackRequestId = 0;
let pendingQueuedEntryId: string | null = null;
let pendingSequenceProposal = false;
let pendingForwardSequenceNavigation = false;
let playOperationId = 0;
let lastKnownPlaybackAccountId = useAuthStore.getState().user?.id ?? null;
let navigationOperation: object | null = null;

async function navigate(action: () => Promise<void>) {
  if (navigationOperation) return;
  const operation = {};
  navigationOperation = operation;
  try {
    await action();
  } finally {
    if (navigationOperation === operation) navigationOperation = null;
  }
}

function collectionKey(
  folderStack: FolderEntry[],
  playlistId?: string,
  playlistFolderStacks?: FolderEntry[][] | null,
) {
  if (playlistId) return `playlist:${playlistId}`;
  if (playlistFolderStacks) return "library-search";
  return `folder:${JSON.stringify(folderStack.map((folder) => folder.id))}`;
}

function revokeCachedSource(source?: string) {
  if (source && isBlobUrl(source)) {
    URL.revokeObjectURL(source);
    return;
  }

  if (source && isSessionMediaUrl(source)) {
    void deleteSessionMedia(source);
  }
}

function setCachedSource(
  cache: Map<string, string>,
  fileId: string,
  source: string,
) {
  const existingSource = cache.get(fileId);
  if (existingSource && existingSource !== source) {
    revokeCachedSource(existingSource);
  }

  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestEntry = cache.keys().next();
    if (!oldestEntry.done) {
      const oldestSource = cache.get(oldestEntry.value);
      revokeCachedSource(oldestSource);
      cache.delete(oldestEntry.value);
    }
  }

  cache.set(fileId, source);
}

function isIosStandalonePwa() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const userAgent = navigator.userAgent;
  const isiOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  return Boolean(standalone) && isiOS;
}

function waitForMediaEvent(
  audio: HTMLAudioElement,
  eventName: keyof HTMLMediaElementEventMap,
  timeoutMs: number,
) {
  return new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const onEvent = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      audio.removeEventListener(eventName, onEvent);
    };

    audio.addEventListener(eventName, onEvent, { once: true });
  });
}

async function attemptAudioPlay(
  audio: HTMLAudioElement,
  timeoutMs = PLAY_ATTEMPT_TIMEOUT_MS,
) {
  let timer: number | undefined;
  let onPlaying: (() => void) | undefined;
  let onError: (() => void) | undefined;
  const mediaError = new Promise<never>((_resolve, reject) => {
    onError = () => {
      if (audio.error?.code === 3 || audio.error?.code === 4)
        reject(new PlaybackError("unsupported_audio"));
    };
    audio.addEventListener("error", onError);
  });
  const started = new Promise<boolean>((resolve) => {
    onPlaying = () => resolve(!audio.paused);
    audio.addEventListener("playing", onPlaying, { once: true });
  });
  try {
    return await Promise.race([
      audio.play().then(() => !audio.paused),
      started,
      mediaError,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(
          () => reject(new PlaybackError("playback_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    if (onPlaying) audio.removeEventListener("playing", onPlaying);
    if (onError) audio.removeEventListener("error", onError);
  }
}

async function reloadCurrentSourceAndPlay(
  audio: HTMLAudioElement,
  isCurrentRequest: () => boolean,
) {
  if (!isCurrentRequest()) return false;
  const source = audio.currentSrc || audio.src;
  if (!source) return false;

  const resumeTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const restorePlaybackPosition = () => {
    if (resumeTime <= 0) return;

    const maxTime =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(0, audio.duration - 0.25)
        : resumeTime;

    try {
      audio.currentTime = Math.min(resumeTime, maxTime);
    } catch {
      // Safari can reject seeks until metadata has loaded again.
    }
  };

  audio.pause();
  audio.src = source;
  audio.load();

  const metadataLoaded = await waitForMediaEvent(
    audio,
    "loadedmetadata",
    PLAY_ATTEMPT_TIMEOUT_MS,
  );

  if (!metadataLoaded || !isCurrentRequest()) {
    return false;
  }

  restorePlaybackPosition();
  const played = await attemptAudioPlay(audio);
  if (!played || !isCurrentRequest()) {
    return false;
  }

  // Re-apply the seek once playback restarts in case Safari ignored it earlier.
  restorePlaybackPosition();
  return true;
}

/**
 * Check if a track belongs to any synced collection (playlist or favorites).
 */
function isTrackSynced(fileId: string): boolean {
  const playlists = usePlaylistStore.getState().playlists;
  const inPlaylist = playlists.some((p) =>
    p.tracks.some((t) => t.fileId === fileId),
  );
  if (inPlaylist) return true;

  const tracks = useLibraryStore.getState().tracks;
  return Boolean(tracks[fileId]?.isFavorite);
}

/**
 * Try to derive a folder stack for a track by looking up its parent folder
 * in the imported library and folder cache. Returns a minimal stack
 * [Library, parentFolder] if found, otherwise [].
 */
function deriveFolderStack(track: DriveFile): FolderEntry[] {
  const { rootFolders } = useImportedDriveStore.getState();
  const cache = useFolderCacheStore.getState().cache;

  const buildPathFromFolderId = (folderId: string): FolderEntry[] => {
    const rootFolder = rootFolders.find((folder) => folder.id === folderId);
    if (rootFolder) {
      return [...INITIAL_STACK, { id: rootFolder.id, name: rootFolder.name }];
    }

    for (const [candidateAncestorId, entry] of cache) {
      const folder = entry.files.find(
        (file) => file.id === folderId && file.mimeType === FOLDER_MIME,
      );
      if (!folder) continue;

      const ancestor = rootFolders.find(
        (rootFolderItem) => rootFolderItem.id === candidateAncestorId,
      );
      if (ancestor) {
        return [
          ...INITIAL_STACK,
          { id: ancestor.id, name: ancestor.name },
          { id: folder.id, name: folder.name },
        ];
      }

      return [...INITIAL_STACK, { id: folder.id, name: folder.name }];
    }

    return [];
  };

  const parentId = track.parents?.[0];
  if (parentId) {
    const path = buildPathFromFolderId(parentId);
    if (path.length > 0) {
      return path;
    }
  }

  // Fallback for older persisted smart-collection items that don't have parents.
  for (const [folderId, entry] of cache) {
    if (entry.files.some((file) => file.id === track.id)) {
      return buildPathFromFolderId(folderId);
    }
  }

  // Last resort: use the stored parent folder name so the title is still clickable
  if (parentId && track.parentFolderName) {
    return [...INITIAL_STACK, { id: parentId, name: track.parentFolderName }];
  }

  return [];
}

interface PlayerState {
  currentTrack: DriveFile | null;
  pendingTrackId: string | null;
  playingFolderStack: FolderEntry[];
  playlistFolderStacks: FolderEntry[][] | null;
  playingPlaylistId: string | null;
  playlist: DriveFile[];
  currentIndex: number;
  playbackSequence: PlaybackSequenceEntry[];
  playbackCursor: number;
  queuedTracks: PlaybackQueueEntry[];
  queuedAccountId: string | null;
  queuedPlaybackContext: {
    entryId: string;
    baseFolderStack: FolderEntry[];
  } | null;
  isPlaying: boolean;
  lastPlaybackFailure: PlaybackFailure | null;
  audioPermission: "unknown" | "blocked" | "allowed";
  playbackAccountId: string | null;
  duration: number;
  currentTime: number;
  // When true, the progress bar jumps to currentTime without its glide
  // transition (used for seeks and track switches). Cleared on the next
  // timeupdate tick via setCurrentTime.
  suppressGlide: boolean;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  isLoading: boolean;
  audio: HTMLAudioElement | null;
  blobCache: Map<string, string>;
  shuffleHistory: string[];
  shuffleCycle: ShuffleCycle | null;
  shuffleCollectionKey: string | null;
  shufflePendingPreviousId: string | null;
  nextShuffleFileId: string | null;
  prefetchingFileId: string | null;
  initAudio: () => HTMLAudioElement;
  play: () => Promise<boolean>;
  confirmPlayback: () => void;
  reportMediaError: () => boolean;
  pause: () => void;
  loadTrack: (
    fileId: string,
    autoplay?: boolean,
    beforeApply?: () => void,
  ) => Promise<boolean>;
  playTrack: (
    track: DriveFile,
    playlist: DriveFile[],
    folderStack: FolderEntry[],
    playlistId?: string,
    playlistFolderStacks?: FolderEntry[][],
    navigation?: "next" | "previous",
    queuedEntry?: PlaybackQueueEntry,
    sequenceEntryId?: string,
    sequenceProposal?: {
      playbackSequence: PlaybackSequenceEntry[];
      playbackCursor: number;
      shuffleCycle: ShuffleCycle;
    },
  ) => Promise<boolean>;
  playQueueEntry: (entryId: string) => Promise<boolean>;
  queueTrack: (
    track: DriveFile,
    position: "next" | "end",
    folderStack?: FolderEntry[],
  ) => void;
  removeQueuedTrack: (entryId: string) => void;
  clearQueuedTracks: () => void;
  fetchAndPlay: (fileId: string) => Promise<boolean>;
  togglePlay: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (p: boolean) => void;
  restoreTrack: () => Promise<void>;
  resetPlayback: () => void;
  cancelPlaybackRequest: (preserveCurrentPlayback?: boolean) => void;
  clearCache: () => void;
  prefetchNextTrack: () => void;
}

function queuedEntries(
  sequence: PlaybackSequenceEntry[],
  cursor: number,
  includeCurrent = false,
): PlaybackQueueEntry[] {
  return sequence
    .filter(
      (entry, index) =>
        entry.sourceIndex === null &&
        (index > cursor || (includeCurrent && index === cursor)),
    )
    .map(({ entryId, track, folderStack }) => ({
      entryId,
      track,
      folderStack,
    }));
}

function restorePlaybackSequence(state: PlayerState) {
  const source = createPlaybackSequence(
    state.playlist,
    state.playlist.map(
      (_track, index) =>
        state.playlistFolderStacks?.[index] ??
        state.queuedPlaybackContext?.baseFolderStack ??
        state.playingFolderStack,
    ),
    state.currentIndex,
    state.shuffle ? state.shuffleCycle : null,
  );
  const additions: PlaybackSequenceEntry[] = state.queuedTracks.map(
    (entry) => ({ ...entry, sourceIndex: null }),
  );
  if (
    state.queuedPlaybackContext &&
    state.currentTrack &&
    !additions.some(
      (entry) => entry.entryId === state.queuedPlaybackContext?.entryId,
    )
  )
    additions.unshift({
      entryId: state.queuedPlaybackContext.entryId,
      track: state.currentTrack,
      folderStack: state.playingFolderStack,
      sourceIndex: null,
    });
  const playbackSequence = [
    ...source.playbackSequence.slice(0, source.playbackCursor + 1),
    ...additions,
    ...source.playbackSequence.slice(source.playbackCursor + 1),
  ];
  return {
    playbackSequence,
    playbackCursor: state.queuedPlaybackContext
      ? playbackSequence.findIndex(
          (entry) => entry.entryId === state.queuedPlaybackContext?.entryId,
        )
      : source.playbackCursor,
  };
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      pendingTrackId: null,
      playingFolderStack: [],
      playlistFolderStacks: null,
      playingPlaylistId: null,
      playlist: [],
      currentIndex: -1,
      playbackSequence: [],
      playbackCursor: -1,
      queuedTracks: [],
      queuedAccountId: null,
      queuedPlaybackContext: null,
      isPlaying: false,
      lastPlaybackFailure: null,
      audioPermission: "unknown",
      playbackAccountId: null,
      duration: 0,
      currentTime: 0,
      suppressGlide: false,
      volume: 0.7,
      isMuted: false,
      shuffle: false,
      repeat: "off",
      isLoading: false,
      audio: null,
      blobCache: new Map(),
      shuffleHistory: [],
      shuffleCycle: null,
      shuffleCollectionKey: null,
      shufflePendingPreviousId: null,
      nextShuffleFileId: null,
      prefetchingFileId: null,

      initAudio: () => {
        const existing = get().audio;
        if (existing) return existing;
        const audio = new Audio();
        audio.volume = get().isMuted ? 0 : get().volume;
        set({ audio });
        return audio;
      },

      play: async () => {
        if (!get().currentTrack && get().queuedTracks.length) {
          await get().next();
          return get().isPlaying;
        }
        const { audio, currentTrack, pendingTrackId } = get();
        if (
          audio?.src &&
          currentTrack &&
          pendingTrackId &&
          pendingTrackId !== currentTrack.id
        ) {
          fetchAbortController?.abort();
          fetchAbortController = null;
          playTrackRequestId++;
          navigationOperation = null;
          set({ pendingTrackId: null, isLoading: false });
        }
        const operationId = ++playOperationId;
        const requestId = playTrackRequestId;
        const userId = useAuthStore.getState().user?.id ?? null;
        const isCurrent = () =>
          operationId === playOperationId &&
          requestId === playTrackRequestId &&
          (useAuthStore.getState().user?.id ?? null) === userId;
        set({ lastPlaybackFailure: null });
        if (!audio) return false;
        const recordFailure = (error: unknown) => {
          if (!isCurrent()) return;
          const failure = getPlaybackFailure(error);
          if (failure)
            set({
              lastPlaybackFailure: failure,
              isPlaying: false,
              ...(failure.code === "audio_user_interaction_required"
                ? { audioPermission: "blocked" as const }
                : {}),
            });
        };
        const finish = (played: boolean) => {
          if (!isCurrent()) return false;
          const observed = played && audio.paused === false;
          set({
            isPlaying: played && !audio.paused,
            ...(observed
              ? {
                  audioPermission: "allowed" as const,
                  lastPlaybackFailure: null,
                }
              : {}),
          });
          if (
            played &&
            currentTrack &&
            get().currentTrack?.id === currentTrack.id
          )
            get().confirmPlayback();
          return played;
        };
        try {
          if (!audio.src) {
            if (!currentTrack) return false;
            return finish(await get().loadTrack(currentTrack.id, true));
          }
          const played = await attemptAudioPlay(audio);
          if (!played) throw new PlaybackError("playback_failed");
          return finish(true);
        } catch (error) {
          if (!isCurrent()) return false;
          const failure = getPlaybackFailure(error);
          if (
            failure &&
            failure.code !== "unsupported_audio" &&
            isIosStandalonePwa() &&
            document.visibilityState === "visible"
          ) {
            try {
              const recovered = await reloadCurrentSourceAndPlay(
                audio,
                isCurrent,
              );
              if (!isCurrent()) return false;
              if (recovered) return finish(true);
            } catch (recoveryError) {
              recordFailure(recoveryError);
              return false;
            }
          }
          recordFailure(error);
          return false;
        }
      },

      confirmPlayback: () => {
        const observed = get();
        if (
          observed.audio?.paused === false &&
          observed.playbackAccountId ===
            (useAuthStore.getState().user?.id ?? null)
        )
          set({
            isPlaying: true,
            audioPermission: "allowed",
            lastPlaybackFailure: null,
          });
        if (observed.queuedPlaybackContext) {
          const entryId = observed.queuedPlaybackContext.entryId;
          set((state) => ({
            queuedTracks: state.queuedTracks.filter(
              (entry) => entry.entryId !== entryId,
            ),
          }));
          return;
        }
        const {
          shuffle,
          currentTrack,
          playlist,
          shuffleCycle,
          shufflePendingPreviousId,
        } = get();
        if (
          !shuffle ||
          !currentTrack ||
          !playlist.some((file) => file.id === currentTrack.id)
        )
          return;
        const cycle = reconcileShuffleCycle(
          shuffleCycle,
          playlist.map((file) => file.id),
        );
        if (
          cycle.playedIds.includes(currentTrack.id) &&
          !shufflePendingPreviousId
        )
          return;
        set((state) => ({
          shuffleCycle: consumeShuffleTrack(cycle, currentTrack.id),
          shuffleHistory:
            shufflePendingPreviousId &&
            shufflePendingPreviousId !== currentTrack.id
              ? [...state.shuffleHistory, shufflePendingPreviousId]
              : state.shuffleHistory,
          shufflePendingPreviousId: null,
          nextShuffleFileId: null,
        }));
      },

      reportMediaError: () => {
        const { audio, playbackAccountId } = get();
        if (playbackAccountId !== (useAuthStore.getState().user?.id ?? null))
          return false;
        if (audio?.error?.code !== 3 && audio?.error?.code !== 4) return false;
        set({
          lastPlaybackFailure: getPlaybackFailure(
            new PlaybackError("unsupported_audio"),
          ),
          isPlaying: false,
          isLoading: false,
        });
        return true;
      },

      pause: () => {
        const { audio } = get();
        if (!audio) return;
        audio.pause();
        set({ isPlaying: false });
      },

      loadTrack: async (fileId, autoplay = true, beforeApply) => {
        // Abort any in-flight fetch so a stale download can't overwrite audio.src
        fetchAbortController?.abort();
        const controller = new AbortController();
        fetchAbortController = controller;
        const requestId = playTrackRequestId;
        const operationId = playOperationId;
        const userId = useAuthStore.getState().user?.id ?? null;
        const isCurrent = () =>
          !controller.signal.aborted &&
          fetchAbortController === controller &&
          requestId === playTrackRequestId &&
          operationId === playOperationId &&
          (useAuthStore.getState().user?.id ?? null) === userId;
        set({ lastPlaybackFailure: null });

        const triggerId3Extraction = (blob: Blob) => {
          const track =
            get().currentTrack ?? get().playlist.find((t) => t.id === fileId);
          const isSynced = isTrackSynced(fileId);
          import("@/stores/id3-metadata-store").then(
            ({ useId3MetadataStore }) => {
              useId3MetadataStore
                .getState()
                .requestMetadata(fileId, blob, track?.modifiedTime, isSynced);
            },
          );
        };

        const audio = get().initAudio();
        const { blobCache } = get();
        const cached = blobCache.get(fileId);

        const applySource = async (source: string) => {
          if (!isCurrent()) return false;
          beforeApply?.();
          audio.src = source;
          audio.currentTime = 0;
          set({ playbackAccountId: userId });

          if (autoplay) {
            try {
              const played = await attemptAudioPlay(
                audio,
                FRESH_SOURCE_PLAY_TIMEOUT_MS,
              );
              if (!isCurrent()) return false;
              if (!played) throw new PlaybackError("playback_failed");
              if (audio.paused === false)
                set({ audioPermission: "allowed", lastPlaybackFailure: null });
            } catch (error) {
              if (!isCurrent()) return false;
              const failure = getPlaybackFailure(error);
              if (failure)
                set({
                  isLoading: false,
                  isPlaying: false,
                  lastPlaybackFailure: failure,
                  ...(failure.code === "audio_user_interaction_required"
                    ? { audioPermission: "blocked" as const }
                    : {}),
                });
              throw error;
            }
          } else {
            audio.load();
            set({
              isPlaying: false,
              currentTime: 0,
              duration: 0,
              suppressGlide: true,
            });
          }

          return true;
        };

        if (cached) {
          if (controller.signal.aborted) return false;
          const played = await applySource(cached);
          if (isCurrent()) set({ isLoading: false });
          return played;
        }

        // Only storage lookup errors fall through to Drive; autoplay failures
        // from an offline source must retain their actual browser diagnosis.
        let offlineRecord: Awaited<ReturnType<typeof offlineDb.getTrack>>;
        try {
          offlineRecord = await offlineDb.getTrack(fileId);
        } catch {
          // IndexedDB unavailable, fall through to Drive fetch.
        }
        if (!isCurrent()) return false;
        if (offlineRecord) {
          const offlineUrl = getOfflineTrackUrl(fileId);
          setCachedSource(blobCache, fileId, offlineUrl);
          triggerId3Extraction(offlineRecord.blob);
          const played = await applySource(offlineUrl);
          if (isCurrent()) set({ isLoading: false });
          return played;
        }

        if (controller.signal.aborted) return false;
        set({ isLoading: true });
        try {
          const authStore = useAuthStore.getState();
          let accessToken = await authStore.getValidAccessToken();
          if (!isCurrent()) return false;
          if (!accessToken) {
            throw new PlaybackError(
              useAuthStore.getState().authStatus === "unauthenticated"
                ? "drive_auth_required"
                : "network_error",
            );
          }

          const fetchTrack = async (token: string) => {
            try {
              return await downloadGoogleDriveFileMedia(
                fileId,
                token,
                controller.signal,
              );
            } catch (error) {
              if (error instanceof TypeError)
                throw new PlaybackError("network_error");
              throw error;
            }
          };

          let res = await fetchTrack(accessToken);
          if (!isCurrent()) return false;
          if (res.status === 401) {
            const refreshed = await useAuthStore
              .getState()
              .refreshAccessToken();
            if (!isCurrent()) return false;
            accessToken = refreshed
              ? useAuthStore.getState().accessToken
              : null;

            if (!accessToken) {
              throw new PlaybackError(
                useAuthStore.getState().authStatus === "unauthenticated"
                  ? "drive_auth_required"
                  : "network_error",
              );
            }

            res = await fetchTrack(accessToken);
            if (!isCurrent()) return false;
          }

          if (!res.ok) throw new GoogleDriveReadError(res.status);

          let blob: Blob;
          try {
            blob = await res.blob();
          } catch (error) {
            if (error instanceof TypeError)
              throw new PlaybackError("network_error");
            throw error;
          }
          if (!isCurrent()) return false;
          triggerId3Extraction(blob);
          const cachedSource =
            (await cacheSessionMedia(fileId, blob, blob.type)) ??
            URL.createObjectURL(blob);

          if (!isCurrent()) {
            revokeCachedSource(cachedSource);
            return false;
          }
          setCachedSource(blobCache, fileId, cachedSource);

          // If a newer fetch started while we were downloading, don't touch audio
          if (controller.signal.aborted) return false;

          const played = await applySource(cachedSource);
          if (isCurrent()) set({ isLoading: false });
          return played;
        } catch (e) {
          if (!isCurrent()) return false;
          const failure = getPlaybackFailure(e);
          set({
            isLoading: false,
            ...(failure ? { lastPlaybackFailure: failure } : {}),
          });
          throw e;
        }
      },

      fetchAndPlay: async (fileId) => {
        const played = await get().loadTrack(fileId, true);
        if (played && get().currentTrack?.id === fileId)
          get().confirmPlayback();
        return played;
      },

      playTrack: async (
        track,
        playlist,
        folderStack,
        playlistId,
        playlistFolderStacks,
        navigation,
        queuedEntry,
        sequenceEntryId,
        sequenceProposal,
      ) => {
        get().initAudio();
        const targetEntry = sequenceEntryId
          ? get().playbackSequence.find(
              (entry) => entry.entryId === sequenceEntryId,
            )
          : undefined;
        const index =
          targetEntry?.sourceIndex ??
          playlist.findIndex((f) => f.id === track.id);
        if (index < 0 && !queuedEntry) return false;
        const requestId = ++playTrackRequestId;
        pendingSequenceProposal = Boolean(sequenceProposal);
        pendingQueuedEntryId = queuedEntry?.entryId ?? null;
        const operationId = ++playOperationId;
        const state = get();
        pendingForwardSequenceNavigation =
          sequenceEntryId !== undefined && navigation === "next";
        const sourceKey = collectionKey(
          folderStack,
          playlistId,
          playlistFolderStacks,
        );
        const previousKey =
          state.shuffleCollectionKey ??
          collectionKey(
            state.playingFolderStack,
            state.playingPlaylistId ?? undefined,
            state.playlistFolderStacks,
          );
        const playlistChanged = previousKey !== sourceKey;
        const nextPlaylistFolderStacks =
          playlistFolderStacks !== undefined
            ? playlistFolderStacks
            : playlistChanged
              ? null
              : state.playlistFolderStacks;

        // Mark the target row active immediately, but keep currentTrack
        // pointing at the playing song until audio actually starts.
        set({ pendingTrackId: track.id, lastPlaybackFailure: null });

        let applied = false;
        try {
          const loaded = await get().loadTrack(track.id, true, () => {
            if (requestId !== playTrackRequestId) return;
            pendingSequenceProposal = false;
            pendingForwardSequenceNavigation = false;
            // Shuffle may have been toggled while the media was downloading.
            const latest = get();
            if (queuedEntry) {
              applied = true;
              const playbackSequence =
                sequenceProposal?.playbackSequence ?? latest.playbackSequence;
              const playbackCursor = playbackSequence.findIndex(
                (entry) => entry.entryId === queuedEntry.entryId,
              );
              set({
                playbackSequence,
                ...(sequenceProposal && latest.shuffle
                  ? { shuffleCycle: sequenceProposal.shuffleCycle }
                  : {}),
                playbackCursor,
                queuedTracks: queuedEntries(
                  playbackSequence,
                  playbackCursor,
                  true,
                ),
                currentTrack: track,
                playingFolderStack: queuedEntry.folderStack,
                queuedPlaybackContext: {
                  entryId: queuedEntry.entryId,
                  baseFolderStack:
                    latest.queuedPlaybackContext?.baseFolderStack ??
                    latest.playingFolderStack,
                },
                isPlaying: true,
                currentTime: 0,
                duration: 0,
                suppressGlide: true,
              });
              return;
            }
            const cycle = latest.shuffle
              ? (sequenceProposal?.shuffleCycle ??
                (playlistChanged
                  ? createShuffleCycle(playlist.map((file) => file.id))
                  : reconcileShuffleCycle(
                      latest.shuffleCycle,
                      playlist.map((file) => file.id),
                      latest.currentTrack?.id,
                    )))
              : null;
            applied = true;
            const sourceFolderStacks = playlist.map((file, fileIndex) =>
              playlistId
                ? deriveFolderStack(file)
                : (nextPlaylistFolderStacks?.[fileIndex] ?? folderStack),
            );
            const sequenceState = sequenceEntryId
              ? {
                  playbackSequence:
                    sequenceProposal?.playbackSequence ??
                    latest.playbackSequence,
                  playbackCursor: (
                    sequenceProposal?.playbackSequence ??
                    latest.playbackSequence
                  ).findIndex((entry) => entry.entryId === sequenceEntryId),
                }
              : createPlaybackSequence(
                  playlist,
                  sourceFolderStacks,
                  index,
                  latest.shuffle ? cycle : null,
                );
            set({
              ...sequenceState,
              currentTrack: track,
              queuedPlaybackContext: null,
              queuedTracks: queuedEntries(
                sequenceState.playbackSequence,
                sequenceState.playbackCursor,
              ),
              playlist,
              currentIndex: index,
              playingFolderStack: playlistId
                ? deriveFolderStack(track)
                : (nextPlaylistFolderStacks?.[index] ?? folderStack),
              playlistFolderStacks: nextPlaylistFolderStacks,
              playingPlaylistId: playlistId ?? null,
              shuffleCollectionKey: sourceKey,
              shuffleCycle: cycle,
              shuffleHistory: playlistChanged
                ? []
                : latest.shuffleHistory.filter((id) =>
                    playlist.some((file) => file.id === id),
                  ),
              shufflePendingPreviousId:
                latest.shuffle && navigation === "next" && !playlistChanged
                  ? (latest.shufflePendingPreviousId ??
                    (latest.queuedPlaybackContext
                      ? latest.playlist[latest.currentIndex]?.id
                      : latest.currentTrack?.id) ??
                    null)
                  : null,
              nextShuffleFileId: null,
              isPlaying: true,
              currentTime: 0,
              duration: 0,
              suppressGlide: true,
            });
          });
          if (requestId !== playTrackRequestId) return false;
          set({ pendingTrackId: null });
          if (operationId !== playOperationId) return false;
          if (!loaded || !applied) {
            if (applied) set({ isPlaying: false });
            return false;
          }
          get().confirmPlayback();
          queueMicrotask(() => get().prefetchNextTrack());
          return true;
        } catch (error) {
          // Preserve the unconsumed target so failed playback can be retried.
          if (requestId === playTrackRequestId) {
            if (operationId !== playOperationId) {
              set({ pendingTrackId: null });
              return false;
            }
            const failure = getPlaybackFailure(error);
            set({
              pendingTrackId: null,
              ...(failure
                ? {
                    lastPlaybackFailure: failure,
                    ...(failure.code === "audio_user_interaction_required"
                      ? { audioPermission: "blocked" as const }
                      : {}),
                  }
                : {}),
              ...(applied ? { isPlaying: false } : {}),
            });
          }
          return false;
        } finally {
          if (requestId === playTrackRequestId) {
            pendingQueuedEntryId = null;
            pendingSequenceProposal = false;
            pendingForwardSequenceNavigation = false;
          }
        }
      },

      togglePlay: () => {
        const { audio } = get();
        if (!get().currentTrack && get().queuedTracks.length) {
          void get().next();
          return;
        }
        if (!audio) return;
        if (audio.paused || audio.ended) {
          void get().play();
        } else {
          get().pause();
        }
      },

      next: () =>
        navigate(async () => {
          if (get().pendingTrackId !== null) return;
          if (!get().playbackSequence.length && get().playlist.length)
            set(restorePlaybackSequence(get()));
          let nextIndex = get().playbackCursor + 1;
          let sequenceProposal:
            | {
                playbackSequence: PlaybackSequenceEntry[];
                playbackCursor: number;
                shuffleCycle: ShuffleCycle;
              }
            | undefined;
          if (nextIndex >= get().playbackSequence.length) {
            if (get().repeat !== "all" || get().playbackSequence.length === 0) {
              get().pause();
              return;
            }
            if (get().shuffle && get().playlist.length) {
              const state = get();
              const cycle = restartShuffleCycle(
                state.playlist.map((track) => track.id),
                state.currentTrack?.id,
                state.nextShuffleFileId,
              );
              const sourceEntries = cycle.remainingIds.flatMap((id) => {
                const entry = state.playbackSequence.find(
                  (item) => item.sourceIndex !== null && item.track.id === id,
                );
                return entry ? [entry] : [];
              });
              let sourceIndex = 0;
              sequenceProposal = {
                playbackSequence: state.playbackSequence.map((entry) =>
                  entry.sourceIndex === null
                    ? entry
                    : (sourceEntries[sourceIndex++] ?? entry),
                ),
                shuffleCycle: cycle,
                playbackCursor: 0,
              };
            }
            nextIndex = 0;
          }
          const nextEntry = (sequenceProposal?.playbackSequence ??
            get().playbackSequence)[nextIndex];
          if (nextEntry) {
            const state = get();
            await get().playTrack(
              nextEntry.track,
              state.playlist,
              nextEntry.folderStack,
              state.playingPlaylistId ?? undefined,
              state.playlistFolderStacks ?? undefined,
              "next",
              nextEntry.sourceIndex === null ? nextEntry : undefined,
              nextEntry.entryId,
              sequenceProposal,
            );
          }
        }),

      playQueueEntry: async (entryId) => {
        const state = get();
        const entryIndex = state.playbackSequence.findIndex(
          (entry) => entry.entryId === entryId,
        );
        const entry = state.playbackSequence[entryIndex];
        if (!entry) return false;
        return get().playTrack(
          entry.track,
          state.playlist,
          entry.folderStack,
          state.playingPlaylistId ?? undefined,
          state.playlistFolderStacks ?? undefined,
          entryIndex < state.playbackCursor ? "previous" : "next",
          entry.sourceIndex === null ? entry : undefined,
          entryId,
        );
      },

      queueTrack: (track, position, folderStack) => {
        let continueCanceledTransition = false;
        if (
          (pendingSequenceProposal ||
            (position === "next" && pendingForwardSequenceNavigation)) &&
          get().pendingTrackId !== null
        ) {
          const state = get();
          continueCanceledTransition = Boolean(
            state.audio?.ended || (state.audio?.paused && !state.isPlaying),
          );
          get().cancelPlaybackRequest(true);
        }
        if (!get().playbackSequence.length && get().playlist.length)
          set(restorePlaybackSequence(get()));
        const entry: PlaybackQueueEntry = {
          entryId: crypto.randomUUID(),
          track,
          folderStack: folderStack ?? deriveFolderStack(track),
        };
        set((state) => ({
          queuedAccountId: useAuthStore.getState().user?.id ?? null,
          ...(!state.currentTrack
            ? { playbackAccountId: useAuthStore.getState().user?.id ?? null }
            : {}),
          playbackSequence:
            position === "next"
              ? [
                  ...state.playbackSequence.slice(0, state.playbackCursor + 1),
                  { ...entry, sourceIndex: null },
                  ...state.playbackSequence.slice(state.playbackCursor + 1),
                ]
              : [...state.playbackSequence, { ...entry, sourceIndex: null }],
          queuedTracks:
            position === "next"
              ? [entry, ...state.queuedTracks]
              : [...state.queuedTracks, entry],
        }));
        if (continueCanceledTransition) {
          const requestId = playTrackRequestId;
          const operationId = playOperationId;
          const accountId = useAuthStore.getState().user?.id ?? null;
          const audio = get().audio;
          queueMicrotask(() => {
            if (
              requestId !== playTrackRequestId ||
              operationId !== playOperationId ||
              accountId !== (useAuthStore.getState().user?.id ?? null) ||
              get().audio !== audio ||
              get().pendingTrackId !== null
            )
              return;
            void get().next();
          });
        }
        queueMicrotask(() => get().prefetchNextTrack());
      },

      removeQueuedTrack: (entryId) => {
        const entryIndex = get().playbackSequence.findIndex(
          (entry) => entry.entryId === entryId && entry.sourceIndex === null,
        );
        if (entryIndex <= get().playbackCursor) return;
        if (pendingSequenceProposal && get().pendingTrackId !== null)
          get().cancelPlaybackRequest(true);
        if (get().pendingTrackId !== null && pendingQueuedEntryId === entryId)
          get().cancelPlaybackRequest(
            get().queuedPlaybackContext?.entryId !== pendingQueuedEntryId,
          );
        set((state) => ({
          playbackSequence: state.playbackSequence.filter(
            (entry) => entry.entryId !== entryId,
          ),
          queuedTracks: state.queuedTracks.filter(
            (item) => item.entryId !== entryId,
          ),
        }));
        queueMicrotask(() => get().prefetchNextTrack());
      },

      clearQueuedTracks: () => {
        if (
          !get().playbackSequence.some(
            (entry, index) =>
              entry.sourceIndex === null && index > get().playbackCursor,
          )
        )
          return;
        if (pendingSequenceProposal && get().pendingTrackId !== null)
          get().cancelPlaybackRequest(true);
        if (
          get().pendingTrackId !== null &&
          pendingQueuedEntryId &&
          get().playbackSequence.some(
            (entry, index) =>
              entry.entryId === pendingQueuedEntryId &&
              index > get().playbackCursor,
          )
        )
          get().cancelPlaybackRequest(
            get().queuedPlaybackContext?.entryId !== pendingQueuedEntryId,
          );
        set((state) => ({
          playbackSequence: state.playbackSequence.filter(
            (entry, index) =>
              entry.sourceIndex !== null || index <= state.playbackCursor,
          ),
          queuedTracks: state.queuedTracks.filter(
            (entry) => entry.entryId === state.queuedPlaybackContext?.entryId,
          ),
        }));
        queueMicrotask(() => get().prefetchNextTrack());
      },

      previous: () =>
        navigate(async () => {
          if (get().pendingTrackId !== null) return;
          if (!get().playbackSequence.length && get().playlist.length)
            set(restorePlaybackSequence(get()));
          const { audio, playbackCursor, playbackSequence } = get();
          if (audio && audio.currentTime > 3) {
            get().seek(0);
            return;
          }
          if (playbackCursor > 0) {
            const played = await get().playQueueEntry(
              playbackSequence[playbackCursor - 1].entryId,
            );
            if (played && get().shuffle)
              set((state) => ({
                shuffleHistory: state.shuffleHistory.slice(0, -1),
              }));
          } else get().seek(0);
        }),

      seek: (time) => {
        const { audio } = get();
        if (audio) {
          audio.currentTime = time;
          set({ currentTime: time, suppressGlide: true });
        }
      },

      setVolume: (vol) => {
        const { audio } = get();
        if (audio) {
          audio.volume = vol;
        }
        set({ volume: vol, isMuted: vol === 0 });
      },

      toggleMute: () => {
        const { audio, isMuted, volume } = get();
        if (!audio) return;
        if (isMuted) {
          audio.volume = volume || 0.7;
          set({ isMuted: false });
        } else {
          audio.volume = 0;
          set({ isMuted: true });
        }
      },

      toggleShuffle: () => {
        if (pendingSequenceProposal && get().pendingTrackId !== null)
          get().cancelPlaybackRequest(true);
        set((s) => {
          const prefix = s.playbackSequence.slice(0, s.playbackCursor + 1);
          const seenSourceIds = new Set(
            prefix
              .filter((entry) => entry.sourceIndex !== null)
              .map((entry) => entry.track.id),
          );
          const tail = s.playbackSequence
            .slice(s.playbackCursor + 1)
            .filter((entry) => {
              if (s.shuffle || entry.sourceIndex === null) return true;
              if (seenSourceIds.has(entry.track.id)) return false;
              seenSourceIds.add(entry.track.id);
              return true;
            });
          const currentEntry = prefix.at(-1);
          let cycle = !s.shuffle
            ? createShuffleCycle(
                s.playlist.map((file) => file.id),
                currentEntry?.sourceIndex === null
                  ? undefined
                  : currentEntry?.track.id,
              )
            : null;
          if (cycle)
            // Shuffle only the visible future. Entries before the cursor retain
            // their place even when playback originally started mid-collection.
            for (const entry of prefix)
              if (entry.sourceIndex !== null)
                cycle = consumeShuffleTrack(cycle, entry.track.id);
          const sourceTail = !s.shuffle
            ? (cycle?.remainingIds ?? []).flatMap((id) => {
                const entry = tail.find(
                  (item) => item.sourceIndex !== null && item.track.id === id,
                );
                return entry ? [entry] : [];
              })
            : tail
                .filter((entry) => entry.sourceIndex !== null)
                .sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
          let sourceIndex = 0;
          return {
            playbackSequence: [
              ...prefix,
              ...tail.map((entry) =>
                entry.sourceIndex === null
                  ? entry
                  : (sourceTail[sourceIndex++] ?? entry),
              ),
            ],
            shuffle: !s.shuffle,
            shuffleHistory: [],
            shufflePendingPreviousId: null,
            shuffleCycle: cycle,
            nextShuffleFileId: null,
          };
        });
        queueMicrotask(() => get().prefetchNextTrack());
      },

      cycleRepeat: () => {
        set((s) => {
          const modes: RepeatMode[] = ["off", "one", "all"];
          const idx = modes.indexOf(s.repeat);
          return { repeat: modes[(idx + 1) % 3] };
        });
        queueMicrotask(() => get().prefetchNextTrack());
      },

      setCurrentTime: (t) => set({ currentTime: t, suppressGlide: false }),
      setDuration: (d) => set({ duration: d }),
      setIsPlaying: (p) => set({ isPlaying: p }),

      restoreTrack: async () => {
        const { currentTrack, audio } = get();
        if (!currentTrack) return;
        if (audio?.src) return;
        await get().loadTrack(currentTrack.id, false);
      },

      cancelPlaybackRequest: (preserveCurrentPlayback = false) => {
        playTrackRequestId++;
        pendingQueuedEntryId = null;
        pendingSequenceProposal = false;
        pendingForwardSequenceNavigation = false;
        playOperationId++;
        navigationOperation = null;
        fetchAbortController?.abort();
        fetchAbortController = null;
        if (!preserveCurrentPlayback) get().pause();
        set({
          pendingTrackId: null,
          isLoading: false,
          lastPlaybackFailure: null,
        });
      },

      resetPlayback: () => {
        playTrackRequestId++;
        pendingQueuedEntryId = null;
        pendingSequenceProposal = false;
        pendingForwardSequenceNavigation = false;
        playOperationId++;
        navigationOperation = null;
        fetchAbortController?.abort();
        fetchAbortController = null;
        prefetchAbortController?.abort();
        prefetchAbortController = null;

        const { audio } = get();
        if (audio) {
          get().pause();
          audio.removeAttribute("src");
          audio.load();
        }

        set({
          currentTrack: null,
          pendingTrackId: null,
          lastPlaybackFailure: null,
          audioPermission: "unknown",
          playbackAccountId: null,
          playingFolderStack: [],
          playlistFolderStacks: null,
          playingPlaylistId: null,
          playlist: [],
          currentIndex: -1,
          playbackSequence: [],
          playbackCursor: -1,
          queuedTracks: [],
          queuedAccountId: null,
          queuedPlaybackContext: null,
          isPlaying: false,
          duration: 0,
          currentTime: 0,
          suppressGlide: true,
          isLoading: false,
          shuffleHistory: [],
          shuffleCycle: null,
          shuffleCollectionKey: null,
          shufflePendingPreviousId: null,
          nextShuffleFileId: null,
          prefetchingFileId: null,
        });
      },

      prefetchNextTrack: () => {
        const {
          playlist,
          currentIndex,
          shuffle,
          repeat,
          blobCache,
          prefetchingFileId,
        } = get();
        const sequenceEntry = get().playbackSequence[get().playbackCursor + 1];
        const queuedEntry =
          sequenceEntry?.sourceIndex === null ? sequenceEntry : undefined;
        if (!sequenceEntry && playlist.length <= 1) return;

        // Determine which track to prefetch
        let nextFileId: string;
        if (sequenceEntry) {
          nextFileId = sequenceEntry.track.id;
          if (shuffle && !queuedEntry) set({ nextShuffleFileId: nextFileId });
        } else if (shuffle) {
          const cycle = reconcileShuffleCycle(
            get().shuffleCycle,
            playlist.map((file) => file.id),
            get().currentTrack?.id,
          );
          // Prefetch peeks at the cycle; only successful playback consumes it.
          set({ shuffleCycle: cycle });
          let prePickedId = cycle.remainingIds[0];
          if (!prePickedId) {
            if (repeat !== "all") {
              set({ nextShuffleFileId: null });
              return;
            }
            prePickedId = restartShuffleCycle(
              playlist.map((file) => file.id),
              get().currentTrack?.id,
              get().nextShuffleFileId,
            ).remainingIds[0];
          }
          set({ nextShuffleFileId: prePickedId });
          nextFileId = prePickedId;
        } else {
          const nextIndex = currentIndex + 1;
          if (nextIndex >= playlist.length) {
            if (repeat === "all") {
              nextFileId = playlist[0].id;
            } else {
              return; // No next track to prefetch
            }
          } else {
            nextFileId = playlist[nextIndex].id;
          }
        }

        // Skip if already cached or already prefetching this track
        if (blobCache.has(nextFileId) || prefetchingFileId === nextFileId)
          return;

        prefetchAbortController?.abort();
        const controller = new AbortController();
        prefetchAbortController = controller;
        set({ prefetchingFileId: nextFileId });

        // Fire-and-forget prefetch
        (async () => {
          try {
            // Check IndexedDB first
            try {
              const offlineRecord = await offlineDb.getTrack(nextFileId);
              if (offlineRecord && !controller.signal.aborted) {
                const offlineUrl = getOfflineTrackUrl(nextFileId);
                const { blobCache } = get();
                setCachedSource(blobCache, nextFileId, offlineUrl);
                return;
              }
            } catch {
              // IndexedDB unavailable, fall through
            }

            if (controller.signal.aborted) return;

            // Fetch from Google Drive
            const authStore = useAuthStore.getState();
            let accessToken = await authStore.getValidAccessToken();
            if (!accessToken) return;

            let res = await downloadGoogleDriveFileMedia(
              nextFileId,
              accessToken,
              controller.signal,
            );
            if (res.status === 401) {
              const refreshed = await useAuthStore
                .getState()
                .refreshAccessToken();
              accessToken = refreshed
                ? useAuthStore.getState().accessToken
                : null;
              if (!accessToken) return;
              res = await downloadGoogleDriveFileMedia(
                nextFileId,
                accessToken,
                controller.signal,
              );
            }
            if (!res.ok) return;

            const blob = await res.blob();
            if (controller.signal.aborted) return;

            const cachedSource =
              (await cacheSessionMedia(nextFileId, blob, blob.type)) ??
              URL.createObjectURL(blob);

            const { blobCache } = get();
            setCachedSource(blobCache, nextFileId, cachedSource);

            // Trigger ID3 extraction for prefetched track
            const track = playlist.find((t) => t.id === nextFileId);
            const isSynced = isTrackSynced(nextFileId);
            import("@/stores/id3-metadata-store").then(
              ({ useId3MetadataStore }) => {
                useId3MetadataStore
                  .getState()
                  .requestMetadata(
                    nextFileId,
                    blob,
                    track?.modifiedTime,
                    isSynced,
                  );
              },
            );
          } catch {
            // Prefetch failures are non-critical
          } finally {
            if (get().prefetchingFileId === nextFileId) {
              set({ prefetchingFileId: null });
            }
          }
        })();
      },

      clearCache: () => {
        const { blobCache } = get();
        for (const source of blobCache.values()) {
          revokeCachedSource(source);
        }
        blobCache.clear();
      },
    }),
    {
      name: "drivebeats-player",
      partialize: (state) => ({
        currentTrack: state.currentTrack,
        playingFolderStack: state.playingFolderStack,
        playlistFolderStacks: state.playlistFolderStacks,
        playingPlaylistId: state.playingPlaylistId,
        playlist: state.playlist,
        currentIndex: state.currentIndex,
        playbackSequence: state.playbackSequence.map((entry) =>
          entry.sourceIndex === null
            ? entry
            : {
                entryId: entry.entryId,
                sourceIndex: entry.sourceIndex,
                folderStack: entry.folderStack,
              },
        ),
        playbackCursor: state.playbackCursor,
        queuedTracks: state.queuedTracks,
        queuedAccountId: state.queuedAccountId,
        queuedPlaybackContext: state.queuedPlaybackContext,
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        shuffleCycle: state.shuffleCycle,
        shuffleCollectionKey: state.shuffleCollectionKey,
        shufflePendingPreviousId: state.shufflePendingPreviousId,
        shuffleHistory: state.shuffleHistory,
        nextShuffleFileId: state.nextShuffleFileId,
      }),
      merge: (persistedState, currentState) => {
        const state = {
          ...currentState,
          ...(persistedState as Partial<PlayerState>),
        };
        state.playbackSequence = state.playbackSequence.flatMap((entry) => {
          if (entry.sourceIndex === null) return [entry];
          const track = state.playlist[entry.sourceIndex];
          return track
            ? [
                {
                  ...entry,
                  track,
                  folderStack:
                    entry.folderStack ??
                    state.playlistFolderStacks?.[entry.sourceIndex] ??
                    state.playingFolderStack,
                },
              ]
            : [];
        });
        if (
          !state.playbackSequence.length &&
          (state.playlist.length ||
            state.queuedTracks.length ||
            state.queuedPlaybackContext)
        )
          Object.assign(state, restorePlaybackSequence(state));
        return state;
      },
    },
  ),
);

useAuthStore.subscribe((state, previous) => {
  const userId = state.user?.id ?? null;
  const previousUserId = previous.user?.id ?? null;
  if (userId === previousUserId) return;
  const knownOwner = lastKnownPlaybackAccountId ?? previousUserId;
  if (userId) lastKnownPlaybackAccountId = userId;
  if (userId && knownOwner && userId !== knownOwner) {
    usePlayerStore.getState().resetPlayback();
    usePlayerStore.getState().clearCache();
    return;
  }
  const queuedAccountId = usePlayerStore.getState().queuedAccountId;
  if (
    (previousUserId && !userId) ||
    (userId && queuedAccountId && userId !== queuedAccountId)
  ) {
    usePlayerStore.getState().resetPlayback();
    usePlayerStore.getState().clearCache();
    return;
  }
  if (userId && previousUserId) {
    usePlayerStore.getState().resetPlayback();
    usePlayerStore.getState().clearCache();
    return;
  }
  playTrackRequestId++;
  pendingQueuedEntryId = null;
  pendingSequenceProposal = false;
  pendingForwardSequenceNavigation = false;
  playOperationId++;
  navigationOperation = null;
  fetchAbortController?.abort();
  fetchAbortController = null;
  usePlayerStore.setState({
    pendingTrackId: null,
    isLoading: false,
    lastPlaybackFailure: null,
    audioPermission: "unknown",
    playbackAccountId: null,
  });
});
