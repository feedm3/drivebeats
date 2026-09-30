import { create } from "zustand";
import { persist } from "zustand/middleware";
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
}) {
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

let fetchAbortController: AbortController | null = null;
let prefetchAbortController: AbortController | null = null;
let playTrackRequestId = 0;
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

async function attemptAudioPlay(audio: HTMLAudioElement) {
  const playPromise = audio
    .play()
    .then(() => true)
    .catch(() => false);
  const startedPlayingPromise = waitForMediaEvent(
    audio,
    "playing",
    PLAY_ATTEMPT_TIMEOUT_MS,
  );

  const didStart = await Promise.race([
    playPromise,
    startedPlayingPromise,
    new Promise<false>((resolve) => {
      window.setTimeout(() => resolve(false), PLAY_ATTEMPT_TIMEOUT_MS);
    }),
  ]);

  return didStart;
}

async function reloadCurrentSourceAndPlay(audio: HTMLAudioElement) {
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

  if (!metadataLoaded) {
    return false;
  }

  restorePlaybackPosition();
  const played = await attemptAudioPlay(audio);
  if (!played) {
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
  isPlaying: boolean;
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
  ) => Promise<boolean>;
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
  clearCache: () => void;
  prefetchNextTrack: () => void;
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
      isPlaying: false,
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
        const { audio, currentTrack } = get();
        if (!audio) return false;
        const requestId = playTrackRequestId;
        const confirmPlayback = () => {
          if (
            requestId === playTrackRequestId &&
            currentTrack &&
            get().currentTrack?.id === currentTrack.id
          )
            get().confirmPlayback();
        };

        if (!audio.src) {
          if (!currentTrack) return false;
          const played = await get().loadTrack(currentTrack.id, true);
          if (played) confirmPlayback();
          return played;
        }

        const played = await attemptAudioPlay(audio);
        if (
          !played &&
          isIosStandalonePwa() &&
          document.visibilityState === "visible"
        ) {
          const recovered = await reloadCurrentSourceAndPlay(audio);
          set({ isPlaying: recovered && !audio.paused });
          if (recovered) confirmPlayback();
          return recovered;
        }

        set({ isPlaying: played && !audio.paused });
        if (played) confirmPlayback();
        return played;
      },

      confirmPlayback: () => {
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
          beforeApply?.();
          audio.src = source;
          audio.currentTime = 0;

          if (autoplay) {
            await audio.play();
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
          await applySource(cached);
          set({ isLoading: false });
          return true;
        }

        // Check IndexedDB for offline-cached media first.
        try {
          const offlineRecord = await offlineDb.getTrack(fileId);
          if (offlineRecord && !controller.signal.aborted) {
            const offlineUrl = getOfflineTrackUrl(fileId);
            setCachedSource(blobCache, fileId, offlineUrl);
            triggerId3Extraction(offlineRecord.blob);
            await applySource(offlineUrl);
            set({ isLoading: false });
            return true;
          }
        } catch {
          // IndexedDB unavailable, fall through to Drive fetch
        }

        set({ isLoading: true });
        try {
          const authStore = useAuthStore.getState();
          let accessToken = await authStore.getValidAccessToken();
          if (!accessToken) {
            throw new Error("Missing valid access token");
          }

          const fetchTrack = (token: string) =>
            downloadGoogleDriveFileMedia(fileId, token, controller.signal);

          let res = await fetchTrack(accessToken);
          if (res.status === 401) {
            const refreshed = await useAuthStore
              .getState()
              .refreshAccessToken();
            accessToken = refreshed
              ? useAuthStore.getState().accessToken
              : null;

            if (!accessToken) {
              throw new Error("Unable to refresh access token");
            }

            res = await fetchTrack(accessToken);
          }

          if (!res.ok) throw new Error(`Drive API returned ${res.status}`);

          const blob = await res.blob();
          triggerId3Extraction(blob);
          const cachedSource =
            (await cacheSessionMedia(fileId, blob, blob.type)) ??
            URL.createObjectURL(blob);

          setCachedSource(blobCache, fileId, cachedSource);

          // If a newer fetch started while we were downloading, don't touch audio
          if (controller.signal.aborted) return false;

          await applySource(cachedSource);
          set({ isLoading: false });
          return true;
        } catch (e) {
          if (controller.signal.aborted) return false;
          set({ isLoading: false });
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
      ) => {
        get().initAudio();
        const index = playlist.findIndex((f) => f.id === track.id);
        if (index < 0) return false;
        const requestId = ++playTrackRequestId;
        const state = get();
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
        set({ pendingTrackId: track.id });

        let applied = false;
        try {
          const loaded = await get().loadTrack(track.id, true, () => {
            if (requestId !== playTrackRequestId) return;
            // Shuffle may have been toggled while the media was downloading.
            const latest = get();
            const cycle = latest.shuffle
              ? playlistChanged
                ? createShuffleCycle(playlist.map((file) => file.id))
                : reconcileShuffleCycle(
                    latest.shuffleCycle,
                    playlist.map((file) => file.id),
                    latest.currentTrack?.id,
                  )
              : null;
            applied = true;
            set({
              currentTrack: track,
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
                    latest.currentTrack?.id ??
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
          if (!loaded || !applied) {
            if (applied) set({ isPlaying: false });
            return false;
          }
          get().confirmPlayback();
          queueMicrotask(() => get().prefetchNextTrack());
          return true;
        } catch {
          // Preserve the unconsumed target so failed playback can be retried.
          if (requestId === playTrackRequestId) {
            set({
              pendingTrackId: null,
              ...(applied ? { isPlaying: false } : {}),
            });
          }
          return false;
        }
      },

      togglePlay: () => {
        const { audio } = get();
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
          const {
            playlist,
            currentIndex,
            currentTrack,
            shuffle,
            repeat,
            nextShuffleFileId,
          } = get();
          if (playlist.length === 0) return;

          let nextIndex: number;
          let nextCycle: ShuffleCycle | null = null;
          if (shuffle) {
            nextCycle = reconcileShuffleCycle(
              get().shuffleCycle,
              playlist.map((file) => file.id),
              currentTrack?.id,
            );
            if (nextCycle.remainingIds.length === 0) {
              if (repeat !== "all") {
                set({ shuffleCycle: nextCycle });
                get().pause();
                return;
              }
              nextCycle = restartShuffleCycle(
                playlist.map((file) => file.id),
                currentTrack?.id,
                nextShuffleFileId,
              );
            }
            nextIndex = playlist.findIndex(
              (file) => file.id === nextCycle?.remainingIds[0],
            );
          } else {
            nextIndex = currentIndex + 1;
            if (nextIndex >= playlist.length) {
              if (repeat === "all") {
                nextIndex = 0;
              } else {
                get().pause();
                return;
              }
            }
          }

          // Keep a failed target available for retry, including at a cycle boundary.
          if (nextCycle) set({ shuffleCycle: nextCycle });
          await get().playTrack(
            playlist[nextIndex],
            playlist,
            get().playingFolderStack,
            get().playingPlaylistId ?? undefined,
            get().playlistFolderStacks ?? undefined,
            "next",
          );
        }),

      previous: () =>
        navigate(async () => {
          if (get().pendingTrackId !== null) return;
          const { audio, playlist, currentIndex, shuffle } = get();
          const shuffleHistory = get().shuffleHistory.filter((id) =>
            playlist.some((file) => file.id === id),
          );
          if (shuffleHistory.length !== get().shuffleHistory.length)
            set({ shuffleHistory });
          if (playlist.length === 0) return;

          if (audio && audio.currentTime > 3) {
            get().seek(0);
            return;
          }

          // In shuffle mode, rewind through play history
          if (shuffle && shuffleHistory.length > 0) {
            const prevId = shuffleHistory[shuffleHistory.length - 1];
            const prevTrack = playlist.find((t) => t.id === prevId);
            if (prevTrack) {
              const played = await get().playTrack(
                prevTrack,
                playlist,
                get().playingFolderStack,
                get().playingPlaylistId ?? undefined,
                get().playlistFolderStacks ?? undefined,
                "previous",
              );
              if (played) {
                set((state) => ({
                  shuffleHistory: state.shuffleHistory.slice(0, -1),
                }));
              }
              return;
            }
          }

          const prevIndex =
            currentIndex - 1 < 0 ? playlist.length - 1 : currentIndex - 1;
          await get().playTrack(
            playlist[prevIndex],
            playlist,
            get().playingFolderStack,
            get().playingPlaylistId ?? undefined,
            get().playlistFolderStacks ?? undefined,
          );
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
        set((s) => ({
          shuffle: !s.shuffle,
          shuffleHistory: [],
          shufflePendingPreviousId: null,
          shuffleCycle: !s.shuffle
            ? createShuffleCycle(
                s.playlist.map((file) => file.id),
                s.currentTrack?.id,
              )
            : null,
          nextShuffleFileId: null,
        }));
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

      resetPlayback: () => {
        playTrackRequestId++;
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
          playingFolderStack: [],
          playlistFolderStacks: null,
          playingPlaylistId: null,
          playlist: [],
          currentIndex: -1,
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
        if (playlist.length <= 1) return;

        // Determine which track to prefetch
        let nextFileId: string;
        if (shuffle) {
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
    },
  ),
);
