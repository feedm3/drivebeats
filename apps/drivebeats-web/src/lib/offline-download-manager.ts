import {
  downloadGoogleDriveFileMedia,
  getGoogleDriveFileMetadata,
} from "@/lib/google-api";
import * as offlineDb from "@/lib/offline-db";
import { recordOfflineDownloadDiagnostic } from "@/lib/offline-download-diagnostics";
import {
  calculateIncrementalDownloadBytes,
  getStorageEstimate,
  requestStoragePersistence,
} from "@/lib/storage-persistence";
import { getTrackSignature } from "@/lib/track-signature";
import { useAuthStore } from "@/stores/auth-store";
import { getFavoriteTracks, useLibraryStore } from "@/stores/library-store";
import {
  type OfflineDownloadErrorCategory,
  useOfflineStore,
} from "@/stores/offline-store";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import type { PlaylistTrack } from "@/types";
import {
  FAVORITES_COLLECTION_ID,
  RECENTLY_PLAYED_COLLECTION_ID,
} from "@/types";

// Two whole-file Blobs cap memory pressure without making correctness depend on
// user-agent sniffing. Measurements can justify an iOS-specific value later.
const MAX_CONCURRENT = 2;
const MAX_TRANSIENT_ATTEMPTS = 3;
const MAX_UNKNOWN_ATTEMPTS = 2;
const AUTH_TIMEOUT_MS = 15_000;
const MEDIA_HEADERS_TIMEOUT_MS = 30_000;
const MEDIA_BODY_TIMEOUT_MS = 120_000;
const DATABASE_TIMEOUT_MS = 15_000;
const STORAGE_API_TIMEOUT_MS = 15_000;
const BACKOFF_BASE_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;

const AUTOMATIC_RETRY_CATEGORIES = new Set<OfflineDownloadErrorCategory>([
  "network",
  "timeout",
  "rate-limited",
  "server",
  "storage-unavailable",
  "integrity",
  "unknown",
]);

export interface OfflineDownloadManager {
  start(): () => void;
  ensureCollectionAvailableOffline(collectionId: string): Promise<void>;
  retryDownloads(collectionId?: string): Promise<void>;
  removeCollectionDownloads(collectionId: string): Promise<void>;
  removeAllDownloads(): Promise<void>;
}

export interface OfflineDownloadManagerDependencies {
  drive: {
    downloadFileMedia(
      fileId: string,
      accessToken: string,
      signal?: AbortSignal,
    ): Promise<Response>;
    getFileMetadata(
      fileId: string,
      accessToken: string,
      params: URLSearchParams,
    ): Promise<Response>;
  };
  database: Pick<
    typeof offlineDb,
    | "clearAll"
    | "deleteCollection"
    | "deleteTrack"
    | "getAllTrackSizes"
    | "getTrack"
    | "putCollection"
    | "putTrack"
  > & {
    resetConnection?: () => void;
  };
  clock: {
    now(): number;
    sleep(delayMs: number): Promise<void>;
    random?: () => number;
  };
  lifecycle: {
    addOnlineListener(listener: () => void): () => void;
  };
}

type GenerationAbortKind = "lifecycle" | "collection-remove" | "remove-all";

interface GenerationAbortReason {
  kind: GenerationAbortKind;
}

interface Runtime {
  dependencies: OfflineDownloadManagerDependencies;
  generation: number;
  generationController: AbortController;
  activeDrain: Promise<void> | null;
  drainRequested: boolean;
  authBlocked: boolean;
  startCallers: number;
  installedCleanups: Array<() => void>;
  retryTimer: ReturnType<typeof setTimeout> | null;
  lifecycleDrainQueued: boolean;
  lifecycleSupersedeQueued: boolean;
  lifecycleTrigger: "online" | "pageshow" | "visibility" | null;
  databaseRecoveryAttempt: number;
  databaseRecoveryAt: number | null;
  storedTrackIds: Set<string>;
}

class DeadlineError extends Error {
  constructor(readonly phase: string) {
    super(`${phase} timed out`);
    this.name = "DeadlineError";
  }
}

class HttpResponseError extends Error {
  constructor(
    readonly response: Response,
    readonly reason?: string,
  ) {
    super(`Drive request failed with ${response.status}`);
    this.name = "HttpResponseError";
  }
}

class IntegrityError extends Error {
  constructor() {
    super("Downloaded Blob size does not match Drive metadata");
    this.name = "IntegrityError";
  }
}

interface FailureDisposition {
  category: OfflineDownloadErrorCategory;
  retryAt?: number;
}

const productionDependencies: OfflineDownloadManagerDependencies = {
  drive: {
    downloadFileMedia: downloadGoogleDriveFileMedia,
    getFileMetadata: getGoogleDriveFileMetadata,
  },
  database: offlineDb,
  clock: {
    now: () => Date.now(),
    sleep: (delayMs) =>
      new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      }),
    random: () => Math.random(),
  },
  lifecycle: {
    addOnlineListener: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      window.addEventListener("online", listener);
      return () => window.removeEventListener("online", listener);
    },
  },
};

function getCollectionTracks(collectionId: string): PlaylistTrack[] {
  if (collectionId === FAVORITES_COLLECTION_ID) {
    return getFavoriteTracks(useLibraryStore.getState().tracks);
  }
  if (collectionId === RECENTLY_PLAYED_COLLECTION_ID) {
    return [];
  }
  return (
    usePlaylistStore
      .getState()
      .playlists.find((playlist) => playlist.id === collectionId)?.tracks ?? []
  );
}

function findTrackById(fileId: string): PlaylistTrack | undefined {
  const favorite = getFavoriteTracks(useLibraryStore.getState().tracks).find(
    (track) => track.fileId === fileId,
  );
  if (favorite) return favorite;

  for (const playlist of usePlaylistStore.getState().playlists) {
    const track = playlist.tracks.find((item) => item.fileId === fileId);
    if (track) return track;
  }
  return undefined;
}

function isGenerationCurrent(runtime: Runtime, generation: number) {
  return runtime.generation === generation;
}

function getGenerationAbortReason(
  signal: AbortSignal,
): GenerationAbortReason | null {
  const reason = signal.reason;
  if (
    typeof reason === "object" &&
    reason !== null &&
    "kind" in reason &&
    (reason.kind === "lifecycle" ||
      reason.kind === "collection-remove" ||
      reason.kind === "remove-all")
  ) {
    return reason as GenerationAbortReason;
  }
  return null;
}

function shouldDiscardCommittedTrack(fileId: string) {
  // A remove followed by an immediate re-enable makes a late completion useful
  // again. Current desired state, not the stale generation's abort reason,
  // decides whether committed bytes should remain.
  return !useOfflineStore.getState().refCounts[fileId];
}

function supersedeGeneration(runtime: Runtime, kind: GenerationAbortKind) {
  runtime.generationController.abort({ kind } satisfies GenerationAbortReason);
  runtime.generation += 1;
  runtime.generationController = new AbortController();
  runtime.authBlocked = false;
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  phase: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new DeadlineError(phase));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function withRequestDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  phase: string,
  controller: AbortController,
) {
  try {
    return await withDeadline(operation, timeoutMs, phase, () => {
      controller.abort(new DeadlineError(phase));
    });
  } catch (error) {
    if (controller.signal.reason instanceof DeadlineError) {
      throw controller.signal.reason;
    }
    throw error;
  }
}

async function deleteTrackIfUnreferenced(
  runtime: Runtime,
  fileId: string,
): Promise<void> {
  if (useOfflineStore.getState().refCounts[fileId]) return;

  const deletion = runtime.dependencies.database.deleteTrack(fileId);
  // Keep ownership of a transaction that outlives our deadline. If it commits
  // after a new reference appears, the follow-up drain restores the Blob.
  void deletion
    .then(() => {
      runtime.storedTrackIds.delete(fileId);
      if (useOfflineStore.getState().refCounts[fileId]) {
        void requestDrain(runtime);
      }
    })
    .catch(() => undefined);
  await withDeadline(
    deletion,
    DATABASE_TIMEOUT_MS,
    "IndexedDB track delete",
    () => runtime.dependencies.database.resetConnection?.(),
  );
}

async function readDriveErrorReason(response: Response): Promise<string> {
  try {
    const data = (await withDeadline(
      response.clone().json(),
      AUTH_TIMEOUT_MS,
      "Drive error response",
    )) as {
      error?: {
        errors?: Array<{ reason?: unknown }>;
      };
    };
    const reason = data.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : "";
  } catch {
    return "";
  }
}

function parseRetryAfter(response: Response, now: number): number | undefined {
  const value = response.headers?.get("Retry-After");
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return now + Math.min(seconds * 1_000, MAX_BACKOFF_MS);
  }

  const date = Date.parse(value);
  if (!Number.isFinite(date) || date <= now) return undefined;
  return now + Math.min(date - now, MAX_BACKOFF_MS);
}

function retryDelay(runtime: Runtime, attempt: number) {
  const base = Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
    MAX_BACKOFF_MS,
  );
  const jitter = 0.8 + (runtime.dependencies.clock.random?.() ?? 0.5) * 0.4;
  return Math.round(base * jitter);
}

async function classifyFailure(
  runtime: Runtime,
  error: unknown,
  attempt: number,
): Promise<FailureDisposition> {
  const now = runtime.dependencies.clock.now();

  if (error instanceof DeadlineError) {
    return {
      category: "timeout",
      retryAt: now + retryDelay(runtime, attempt),
    };
  }
  if (error instanceof IntegrityError) {
    return {
      category: "integrity",
      retryAt: now + retryDelay(runtime, attempt),
    };
  }
  if (error instanceof HttpResponseError) {
    const { status } = error.response;
    if (status === 401) return { category: "auth-required" };
    if (status === 404) return { category: "missing-file" };
    if (status === 403) {
      const retryable =
        error.reason === "rateLimitExceeded" ||
        error.reason === "userRateLimitExceeded";
      return retryable
        ? {
            category: "rate-limited",
            retryAt:
              parseRetryAfter(error.response, now) ??
              now + retryDelay(runtime, attempt),
          }
        : { category: "access-denied" };
    }
    if (status === 408 || status === 429) {
      return {
        category: "rate-limited",
        retryAt:
          parseRetryAfter(error.response, now) ??
          now + retryDelay(runtime, attempt),
      };
    }
    if (status >= 500) {
      return {
        category: "server",
        retryAt: now + retryDelay(runtime, attempt),
      };
    }
    return { category: "access-denied" };
  }
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return { category: "storage-full" };
  }
  if (
    error instanceof DOMException &&
    (error.name === "UnknownError" ||
      error.name === "InvalidStateError" ||
      error.name === "TransactionInactiveError")
  ) {
    runtime.dependencies.database.resetConnection?.();
    return {
      category: "storage-unavailable",
      retryAt: now + retryDelay(runtime, attempt),
    };
  }
  if (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "NetworkError")
  ) {
    return {
      category: "network",
      retryAt: now + retryDelay(runtime, attempt),
    };
  }
  return {
    category: "unknown",
    retryAt: now + retryDelay(runtime, attempt),
  };
}

function maximumAttempts(category: OfflineDownloadErrorCategory) {
  return category === "unknown" ? MAX_UNKNOWN_ATTEMPTS : MAX_TRANSIENT_ATTEMPTS;
}

function updateCollectionProgress() {
  const store = useOfflineStore.getState();
  for (const [collectionId, collection] of Object.entries(store.collections)) {
    let downloadedCount = 0;
    for (const fileId of collection.trackFileIds) {
      if (store.trackJobs[fileId]?.status === "downloaded") {
        downloadedCount += 1;
      }
    }
    store.updateCollectionProgress(collectionId, {
      downloadedCount,
      totalCount: collection.trackFileIds.length,
    });
  }
}

function getAuthoritativeCollectionTracks(
  collectionId: string,
): PlaylistTrack[] | null {
  if (collectionId === FAVORITES_COLLECTION_ID) {
    const library = useLibraryStore.getState();
    return library.isCloudHydrated ? getFavoriteTracks(library.tracks) : null;
  }
  if (collectionId === RECENTLY_PLAYED_COLLECTION_ID) return null;

  const playlists = usePlaylistStore.getState();
  if (!playlists.isCloudHydrated) return null;
  return (
    playlists.playlists.find((playlist) => playlist.id === collectionId)
      ?.tracks ?? []
  );
}

async function persistCollectionCompatibility(
  runtime: Runtime,
  collectionId: string,
  generation: number,
) {
  const collection = useOfflineStore.getState().collections[collectionId];
  if (!collection) return;

  await withDeadline(
    runtime.dependencies.database.putCollection(collectionId, {
      ...collection,
      lastSyncedAt: runtime.dependencies.clock.now(),
    }),
    DATABASE_TIMEOUT_MS,
    "IndexedDB collection write",
    () => runtime.dependencies.database.resetConnection?.(),
  );
  if (!isGenerationCurrent(runtime, generation)) return;
}

async function reconcileAuthoritativeMembership(
  runtime: Runtime,
  generation: number,
) {
  for (const collectionId of Object.keys(
    useOfflineStore.getState().collections,
  )) {
    if (!isGenerationCurrent(runtime, generation)) return;
    const tracks = getAuthoritativeCollectionTracks(collectionId);
    if (tracks === null) continue;

    const stateBefore = useOfflineStore.getState();
    const current = stateBefore.collections[collectionId];
    if (!current) continue;
    const nextIds = tracks.map((track) => track.fileId);
    if (
      getTrackSignature(
        current.trackFileIds.map((fileId) => ({ fileId }) as PlaylistTrack),
      ) === getTrackSignature(tracks)
    ) {
      continue;
    }

    const nextSet = new Set(nextIds);
    const orphaned = current.trackFileIds.filter(
      (fileId) =>
        !nextSet.has(fileId) && (stateBefore.refCounts[fileId] ?? 1) <= 1,
    );
    stateBefore.syncCollectionTracks(collectionId, nextIds);

    await Promise.all(
      orphaned.map((fileId) => deleteTrackIfUnreferenced(runtime, fileId)),
    );
    await persistCollectionCompatibility(runtime, collectionId, generation);
  }
}

async function reconcileStoredTracks(
  runtime: Runtime,
  generation: number,
): Promise<boolean> {
  const stored = await withDeadline(
    runtime.dependencies.database.getAllTrackSizes(),
    DATABASE_TIMEOUT_MS,
    "IndexedDB track scan",
    () => runtime.dependencies.database.resetConnection?.(),
  );
  if (!isGenerationCurrent(runtime, generation)) return false;

  const storedSizes = new Map(
    stored.map(({ fileId, sizeBytes }) => [fileId, sizeBytes]),
  );
  runtime.storedTrackIds = new Set(storedSizes.keys());
  const staleFileIds = new Set<string>();
  await Promise.all(
    [...storedSizes.keys()].map(async (fileId) => {
      if (!useOfflineStore.getState().refCounts[fileId]) return;
      const track = findTrackById(fileId);
      if (!track?.modifiedTime) return;
      const record = await withDeadline(
        runtime.dependencies.database.getTrack(fileId),
        DATABASE_TIMEOUT_MS,
        "IndexedDB track read",
        () => runtime.dependencies.database.resetConnection?.(),
      );
      if (record?.modifiedTime && record.modifiedTime !== track.modifiedTime) {
        staleFileIds.add(fileId);
      }
    }),
  );
  if (!isGenerationCurrent(runtime, generation)) return false;
  let foundEligible = false;

  useOfflineStore.setState((state) => {
    const trackJobs = { ...state.trackJobs };
    const trackStatus = { ...state.trackStatus };

    // Read the live ref-count set after the awaited scan. Cloud additions made
    // during recovery therefore merge into the result instead of disappearing.
    for (const fileId of Object.keys(state.refCounts)) {
      const current = trackJobs[fileId] ?? {
        status: "queued",
        phase: "idle",
        attempt: 0,
      };
      const status = staleFileIds.has(fileId)
        ? "updating"
        : storedSizes.has(fileId)
          ? "downloaded"
          : current.status === "failed"
            ? "failed"
            : "queued";
      trackJobs[fileId] = {
        ...current,
        status,
        phase: "idle",
        ...(status === "downloaded"
          ? { errorCategory: undefined, nextAttemptAt: undefined }
          : {}),
      };
      trackStatus[fileId] = status;
      if (status === "queued" || status === "updating") {
        foundEligible = true;
      }
    }

    for (const fileId of Object.keys(trackJobs)) {
      if (state.refCounts[fileId] === undefined) {
        delete trackJobs[fileId];
        delete trackStatus[fileId];
      }
    }

    return { trackJobs, trackStatus };
  });

  updateCollectionProgress();
  return foundEligible;
}

async function reconcile(runtime: Runtime, generation: number) {
  await reconcileAuthoritativeMembership(runtime, generation);
  if (!isGenerationCurrent(runtime, generation)) return false;
  return reconcileStoredTracks(runtime, generation);
}

function selectEligibleTracks(runtime: Runtime): PlaylistTrack[] {
  if (runtime.authBlocked) return [];
  const now = runtime.dependencies.clock.now();
  const state = useOfflineStore.getState();
  const tracks: PlaylistTrack[] = [];

  for (const [fileId, job] of Object.entries(state.trackJobs)) {
    if (!state.refCounts[fileId]) continue;
    const eligibleQueued = job.status === "queued" || job.status === "updating";
    const eligibleFailure =
      job.status === "failed" &&
      Boolean(
        job.errorCategory && AUTOMATIC_RETRY_CATEGORIES.has(job.errorCategory),
      ) &&
      (job.nextAttemptAt ?? 0) <= now &&
      job.attempt < maximumAttempts(job.errorCategory ?? "unknown");
    if (!eligibleQueued && !eligibleFailure) continue;

    const track = findTrackById(fileId);
    if (track) tracks.push(track);
  }
  return tracks;
}

function scheduleRetryTimer(runtime: Runtime) {
  if (runtime.retryTimer) {
    clearTimeout(runtime.retryTimer);
    runtime.retryTimer = null;
  }
  if (runtime.startCallers === 0 || typeof document === "undefined") return;
  if (document.visibilityState === "hidden") return;

  const now = runtime.dependencies.clock.now();
  const nextJobAttemptAt = Object.values(useOfflineStore.getState().trackJobs)
    .filter(
      (job) =>
        job.status === "failed" &&
        job.errorCategory &&
        AUTOMATIC_RETRY_CATEGORIES.has(job.errorCategory) &&
        job.attempt < maximumAttempts(job.errorCategory),
    )
    .map((job) => job.nextAttemptAt)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  const nextAttemptAt =
    runtime.databaseRecoveryAt === null
      ? nextJobAttemptAt
      : nextJobAttemptAt === undefined
        ? runtime.databaseRecoveryAt
        : Math.min(nextJobAttemptAt, runtime.databaseRecoveryAt);
  if (nextAttemptAt === undefined) return;

  runtime.retryTimer = setTimeout(
    () => {
      runtime.retryTimer = null;
      if (
        runtime.databaseRecoveryAt !== null &&
        runtime.databaseRecoveryAt <= runtime.dependencies.clock.now()
      ) {
        runtime.databaseRecoveryAt = null;
      }
      void requestDrain(runtime);
    },
    Math.max(0, nextAttemptAt - now),
  );
}

async function capacityGuard(
  runtime: Runtime,
  tracks: PlaylistTrack[],
  generation: number,
): Promise<PlaylistTrack[]> {
  if (tracks.length === 0) return tracks;
  let estimate: Awaited<ReturnType<typeof getStorageEstimate>>;
  try {
    estimate = await withDeadline(
      getStorageEstimate(),
      STORAGE_API_TIMEOUT_MS,
      "storage estimate",
    );
  } catch {
    // Capacity estimates are advisory; the actual IndexedDB write remains
    // bounded and catches QuotaExceededError.
    return isGenerationCurrent(runtime, generation) ? tracks : [];
  }
  if (!isGenerationCurrent(runtime, generation)) return [];
  if (!estimate) return tracks;

  const incrementalBytes = calculateIncrementalDownloadBytes(
    tracks,
    runtime.storedTrackIds,
    new Set(),
  );
  if (
    incrementalBytes <= 0 ||
    incrementalBytes <= Math.max(0, estimate.quota - estimate.usage)
  ) {
    return tracks;
  }

  for (const track of tracks) {
    if (!isGenerationCurrent(runtime, generation)) return [];
    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "failed",
      phase: "idle",
      attempt: useOfflineStore.getState().trackJobs[track.fileId]?.attempt ?? 0,
      errorCategory: "storage-full",
      nextAttemptAt: undefined,
    });
  }
  updateCollectionProgress();
  return [];
}

async function getAccessToken(
  runtime: Runtime,
  generation: number,
): Promise<string | null> {
  useOfflineStore.getState().setIsDownloading(true);
  const token = await withDeadline(
    useAuthStore.getState().getValidAccessToken(),
    AUTH_TIMEOUT_MS,
    "authentication",
  );
  if (!isGenerationCurrent(runtime, generation)) return null;
  return token;
}

async function downloadResponse(
  runtime: Runtime,
  track: PlaylistTrack,
  generation: number,
  generationSignal: AbortSignal,
  previousAttempt: number,
): Promise<Blob | null> {
  useOfflineStore.getState().updateTrackJob(track.fileId, {
    status: "downloading",
    phase: "authorizing",
    attempt: previousAttempt,
    lastAttemptAt: runtime.dependencies.clock.now(),
    errorCategory: undefined,
    nextAttemptAt: undefined,
  });

  let accessToken = await getAccessToken(runtime, generation);
  if (!isGenerationCurrent(runtime, generation)) return null;
  if (!accessToken) {
    const authStatus = useAuthStore.getState().authStatus;
    if (authStatus === "unauthenticated") {
      throw new HttpResponseError(new Response(null, { status: 401 }));
    }
    runtime.authBlocked = true;
    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "queued",
      phase: "idle",
      attempt: previousAttempt,
    });
    return null;
  }

  const requestController = new AbortController();
  const abortRequest = () => {
    requestController.abort(generationSignal.reason);
  };
  if (generationSignal.aborted) {
    abortRequest();
  } else {
    generationSignal.addEventListener("abort", abortRequest, { once: true });
  }

  try {
    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "downloading",
      phase: "fetching",
    });
    let response = await withRequestDeadline(
      runtime.dependencies.drive.downloadFileMedia(
        track.fileId,
        accessToken,
        requestController.signal,
      ),
      MEDIA_HEADERS_TIMEOUT_MS,
      "media response headers",
      requestController,
    );
    if (!isGenerationCurrent(runtime, generation) || generationSignal.aborted) {
      return null;
    }

    if (response.status === 401) {
      const refreshed = await withDeadline(
        useAuthStore.getState().refreshAccessToken(),
        AUTH_TIMEOUT_MS,
        "authentication refresh",
      );
      if (!refreshed) {
        const authStatus = useAuthStore.getState().authStatus;
        if (authStatus !== "unauthenticated") {
          runtime.authBlocked = true;
          useOfflineStore.getState().updateTrackJob(track.fileId, {
            status: "queued",
            phase: "idle",
            attempt: previousAttempt,
          });
          return null;
        }
        throw new HttpResponseError(response);
      }
      if (
        !isGenerationCurrent(runtime, generation) ||
        generationSignal.aborted
      ) {
        return null;
      }

      accessToken = useAuthStore.getState().accessToken;
      if (!accessToken) return null;
      response = await withRequestDeadline(
        runtime.dependencies.drive.downloadFileMedia(
          track.fileId,
          accessToken,
          requestController.signal,
        ),
        MEDIA_HEADERS_TIMEOUT_MS,
        "media response headers",
        requestController,
      );
      if (
        !isGenerationCurrent(runtime, generation) ||
        generationSignal.aborted
      ) {
        return null;
      }
    }

    if (!response.ok) {
      throw new HttpResponseError(
        response,
        response.status === 403
          ? await readDriveErrorReason(response)
          : undefined,
      );
    }

    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "downloading",
      phase: "reading",
    });
    const blob = await withRequestDeadline(
      response.blob(),
      MEDIA_BODY_TIMEOUT_MS,
      "media response body",
      requestController,
    );
    if (!isGenerationCurrent(runtime, generation) || generationSignal.aborted) {
      return null;
    }

    const expectedSize = Number(track.size);
    if (
      Number.isFinite(expectedSize) &&
      expectedSize >= 0 &&
      blob.size !== expectedSize
    ) {
      throw new IntegrityError();
    }
    return blob;
  } finally {
    generationSignal.removeEventListener("abort", abortRequest);
  }
}

async function processTrack(
  runtime: Runtime,
  track: PlaylistTrack,
  generation: number,
  generationSignal: AbortSignal,
) {
  const initialJob = useOfflineStore.getState().trackJobs[track.fileId];
  if (
    !initialJob ||
    initialJob.status === "downloaded" ||
    !useOfflineStore.getState().refCounts[track.fileId]
  ) {
    return;
  }
  const attempt = initialJob.attempt + 1;

  void recordOfflineDownloadDiagnostic({
    timestamp: runtime.dependencies.clock.now(),
    generation,
    attempt,
    phase: "authorizing",
    outcome: "started",
    visible:
      typeof document === "undefined" || document.visibilityState === "visible",
  });

  try {
    const blob = await downloadResponse(
      runtime,
      track,
      generation,
      generationSignal,
      initialJob.attempt,
    );
    if (!blob || !isGenerationCurrent(runtime, generation)) return;
    if (!useOfflineStore.getState().refCounts[track.fileId]) return;

    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "downloading",
      phase: "storing",
    });
    const write = runtime.dependencies.database.putTrack(track.fileId, {
      blob,
      sizeBytes: blob.size,
      mimeType: track.mimeType ?? "audio/mpeg",
      name: track.fileName,
      modifiedTime: track.modifiedTime,
      downloadedAt: runtime.dependencies.clock.now(),
    });

    void write
      .then(async () => {
        if (shouldDiscardCommittedTrack(track.fileId)) {
          await deleteTrackIfUnreferenced(runtime, track.fileId);
        } else if (!isGenerationCurrent(runtime, generation)) {
          void requestDrain(runtime);
        }
      })
      .catch(() => undefined);
    await withDeadline(
      write,
      DATABASE_TIMEOUT_MS,
      "IndexedDB track write",
      () => runtime.dependencies.database.resetConnection?.(),
    );
    runtime.storedTrackIds.add(track.fileId);

    if (
      !isGenerationCurrent(runtime, generation) ||
      !useOfflineStore.getState().refCounts[track.fileId]
    ) {
      if (shouldDiscardCommittedTrack(track.fileId)) {
        await deleteTrackIfUnreferenced(runtime, track.fileId);
      }
      return;
    }

    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "downloaded",
      phase: "idle",
      attempt,
      errorCategory: undefined,
      nextAttemptAt: undefined,
    });
    void recordOfflineDownloadDiagnostic({
      timestamp: runtime.dependencies.clock.now(),
      generation,
      attempt,
      phase: "idle",
      blobSize: blob.size,
      outcome: "downloaded",
    });
  } catch (error) {
    const abortReason = getGenerationAbortReason(generationSignal);
    if (
      abortReason ||
      !isGenerationCurrent(runtime, generation) ||
      !useOfflineStore.getState().refCounts[track.fileId]
    ) {
      return;
    }

    const failure = await classifyFailure(runtime, error, attempt);
    const mayRetry =
      AUTOMATIC_RETRY_CATEGORIES.has(failure.category) &&
      attempt < maximumAttempts(failure.category);
    useOfflineStore.getState().updateTrackJob(track.fileId, {
      status: "failed",
      phase: "idle",
      attempt,
      errorCategory: failure.category,
      nextAttemptAt: mayRetry ? failure.retryAt : undefined,
    });
    void recordOfflineDownloadDiagnostic({
      timestamp: runtime.dependencies.clock.now(),
      generation,
      attempt,
      phase: "idle",
      errorCategory: failure.category,
      errorName: error instanceof Error ? error.name : "UnknownError",
      outcome: "failed",
    });
  } finally {
    updateCollectionProgress();
  }
}

async function processEligibleTracks(runtime: Runtime, generation: number) {
  const selectedTracks = selectEligibleTracks(runtime);
  const tracks = await capacityGuard(runtime, selectedTracks, generation);
  if (!isGenerationCurrent(runtime, generation)) return false;
  if (tracks.length === 0) return false;

  let index = 0;
  const signal = runtime.generationController.signal;
  const worker = async () => {
    while (
      index < tracks.length &&
      isGenerationCurrent(runtime, generation) &&
      !signal.aborted &&
      !runtime.authBlocked
    ) {
      const track = tracks[index];
      index += 1;
      await processTrack(runtime, track, generation, signal);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, tracks.length) }, () =>
      worker(),
    ),
  );
  return true;
}

async function drain(runtime: Runtime) {
  useOfflineStore.getState().setIsDownloading(true);
  try {
    while (runtime.drainRequested) {
      runtime.drainRequested = false;
      const generation = runtime.generation;
      try {
        await reconcile(runtime, generation);
        if (!isGenerationCurrent(runtime, generation)) {
          runtime.drainRequested = runtime.startCallers > 0;
          continue;
        }
        runtime.databaseRecoveryAttempt = 0;
        runtime.databaseRecoveryAt = null;
        const processed = await processEligibleTracks(runtime, generation);
        if (
          processed &&
          !runtime.authBlocked &&
          selectEligibleTracks(runtime).length > 0
        ) {
          runtime.drainRequested = true;
        }
      } catch (error) {
        if (isGenerationCurrent(runtime, generation)) {
          runtime.dependencies.database.resetConnection?.();
          runtime.databaseRecoveryAttempt += 1;
          if (runtime.databaseRecoveryAttempt <= MAX_TRANSIENT_ATTEMPTS) {
            runtime.databaseRecoveryAt =
              runtime.dependencies.clock.now() +
              retryDelay(runtime, runtime.databaseRecoveryAttempt);
          }
          if (!(error instanceof DeadlineError)) {
            console.warn("Offline reconciliation failed:", error);
          }
        }
      }
    }
  } finally {
    runtime.activeDrain = null;
    useOfflineStore.getState().setIsDownloading(false);
    updateCollectionProgress();
    scheduleRetryTimer(runtime);
    if (runtime.drainRequested) {
      void requestDrain(runtime);
    }
  }
}

function requestDrain(runtime: Runtime): Promise<void> {
  runtime.drainRequested = true;
  if (!runtime.activeDrain) {
    runtime.activeDrain = drain(runtime);
  }
  return runtime.activeDrain;
}

function queueLifecycleDrain(
  runtime: Runtime,
  supersede: boolean,
  trigger: "online" | "pageshow" | "visibility",
) {
  runtime.lifecycleSupersedeQueued ||= supersede;
  if (trigger !== "online" || runtime.lifecycleTrigger === null) {
    runtime.lifecycleTrigger = trigger;
  }
  if (runtime.lifecycleDrainQueued) return;
  runtime.lifecycleDrainQueued = true;
  queueMicrotask(() => {
    runtime.lifecycleDrainQueued = false;
    const shouldSupersede = runtime.lifecycleSupersedeQueued;
    const queuedTrigger = runtime.lifecycleTrigger ?? trigger;
    runtime.lifecycleSupersedeQueued = false;
    runtime.lifecycleTrigger = null;
    if (runtime.startCallers === 0) return;
    if (shouldSupersede) supersedeGeneration(runtime, "lifecycle");
    void recordOfflineDownloadDiagnostic({
      timestamp: runtime.dependencies.clock.now(),
      trigger: queuedTrigger,
      generation: runtime.generation,
      visible:
        typeof document === "undefined" ||
        document.visibilityState === "visible",
      outcome: "reconciled",
    });
    void requestDrain(runtime);
  });
}

function librarySignature() {
  const state = useLibraryStore.getState();
  return `${state.isCloudHydrated}:${getTrackSignature(
    getFavoriteTracks(state.tracks),
  )}`;
}

function playlistSignature() {
  const state = usePlaylistStore.getState();
  return `${state.isCloudHydrated}:${state.playlists
    .map((playlist) => `${playlist.id}:${getTrackSignature(playlist.tracks)}`)
    .join("|")}`;
}

function authSignature() {
  const state = useAuthStore.getState();
  return `${state.authStatus}:${state.accessToken ?? ""}:${state.expiresAt ?? ""}`;
}

function install(runtime: Runtime) {
  let previousLibrarySignature = librarySignature();
  let previousPlaylistSignature = playlistSignature();
  let previousAuthSignature = authSignature();

  runtime.installedCleanups.push(
    runtime.dependencies.lifecycle.addOnlineListener(() => {
      queueLifecycleDrain(runtime, false, "online");
    }),
    useLibraryStore.subscribe(() => {
      const next = librarySignature();
      if (next === previousLibrarySignature) return;
      previousLibrarySignature = next;
      void requestDrain(runtime);
    }),
    usePlaylistStore.subscribe(() => {
      const next = playlistSignature();
      if (next === previousPlaylistSignature) return;
      previousPlaylistSignature = next;
      void requestDrain(runtime);
    }),
    useAuthStore.subscribe(() => {
      const next = authSignature();
      if (next === previousAuthSignature) return;
      previousAuthSignature = next;
      runtime.authBlocked = false;
      void requestDrain(runtime);
    }),
  );

  if (typeof window !== "undefined") {
    const onPageShow = () => queueLifecycleDrain(runtime, true, "pageshow");
    window.addEventListener("pageshow", onPageShow);
    runtime.installedCleanups.push(() =>
      window.removeEventListener("pageshow", onPageShow),
    );
  }
  if (typeof document !== "undefined") {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (runtime.retryTimer) {
          clearTimeout(runtime.retryTimer);
          runtime.retryTimer = null;
        }
        return;
      }
      queueLifecycleDrain(runtime, true, "visibility");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    runtime.installedCleanups.push(() =>
      document.removeEventListener("visibilitychange", onVisibilityChange),
    );
  }

  void recordOfflineDownloadDiagnostic({
    timestamp: runtime.dependencies.clock.now(),
    trigger: "start",
    generation: runtime.generation,
    visible:
      typeof document === "undefined" || document.visibilityState === "visible",
    outcome: "reconciled",
  });
  void requestDrain(runtime);
}

function uninstall(runtime: Runtime) {
  for (const cleanup of runtime.installedCleanups.splice(0)) cleanup();
  if (runtime.retryTimer) {
    clearTimeout(runtime.retryTimer);
    runtime.retryTimer = null;
  }
  runtime.drainRequested = false;
  runtime.databaseRecoveryAttempt = 0;
  runtime.databaseRecoveryAt = null;
  supersedeGeneration(runtime, "lifecycle");
}

export function createOfflineDownloadManager(
  dependencies: OfflineDownloadManagerDependencies = productionDependencies,
): OfflineDownloadManager {
  const runtime: Runtime = {
    dependencies,
    generation: 1,
    generationController: new AbortController(),
    activeDrain: null,
    drainRequested: false,
    authBlocked: false,
    startCallers: 0,
    installedCleanups: [],
    retryTimer: null,
    lifecycleDrainQueued: false,
    lifecycleSupersedeQueued: false,
    lifecycleTrigger: null,
    databaseRecoveryAttempt: 0,
    databaseRecoveryAt: null,
    storedTrackIds: new Set(),
  };

  return {
    start: () => {
      runtime.startCallers += 1;
      if (runtime.startCallers === 1) install(runtime);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        runtime.startCallers -= 1;
        if (runtime.startCallers === 0) uninstall(runtime);
      };
    },

    ensureCollectionAvailableOffline: async (collectionId) => {
      let persistence: Awaited<ReturnType<typeof requestStoragePersistence>> =
        "unknown";
      try {
        persistence = await withDeadline(
          requestStoragePersistence(),
          STORAGE_API_TIMEOUT_MS,
          "storage persistence request",
        );
      } catch {
        // Persistence is advisory. A suspended browser prompt must not prevent
        // desired offline intent from being recorded.
      }
      useOfflineStore.getState().setStoragePersistence(persistence);
      const tracks = getCollectionTracks(collectionId);
      if (tracks.length === 0) return;
      const fileIds = tracks.map((track) => track.fileId);
      const store = useOfflineStore.getState();
      const sharedFileIds = new Set(Object.keys(store.refCounts));
      let storedFileIds = new Set<string>();
      try {
        const stored = await withDeadline(
          dependencies.database.getAllTrackSizes(),
          DATABASE_TIMEOUT_MS,
          "IndexedDB capacity scan",
          () => dependencies.database.resetConnection?.(),
        );
        storedFileIds = new Set(stored.map(({ fileId }) => fileId));
      } catch {
        // Capacity estimates are advisory. The actual write remains guarded.
      }
      const incrementalBytes = calculateIncrementalDownloadBytes(
        tracks,
        storedFileIds,
        sharedFileIds,
      );
      let estimate: Awaited<ReturnType<typeof getStorageEstimate>> = null;
      try {
        estimate = await withDeadline(
          getStorageEstimate(),
          STORAGE_API_TIMEOUT_MS,
          "storage estimate",
        );
      } catch {
        // The write path still catches actual quota failures.
      }
      store.enableCollection(collectionId, fileIds);
      if (
        estimate &&
        incrementalBytes > Math.max(0, estimate.quota - estimate.usage)
      ) {
        for (const fileId of fileIds) {
          if (!storedFileIds.has(fileId) && !sharedFileIds.has(fileId)) {
            useOfflineStore.getState().updateTrackJob(fileId, {
              status: "failed",
              phase: "idle",
              attempt: 0,
              errorCategory: "storage-full",
            });
          }
        }
      }
      await persistCollectionCompatibility(
        runtime,
        collectionId,
        runtime.generation,
      );
      await requestDrain(runtime);
    },

    retryDownloads: async (collectionId) => {
      const store = useOfflineStore.getState();
      const fileIds = collectionId
        ? (store.collections[collectionId]?.trackFileIds ?? [])
        : Object.keys(store.refCounts);
      store.resetRetryableJobs(fileIds);
      runtime.authBlocked = false;
      runtime.databaseRecoveryAttempt = 0;
      runtime.databaseRecoveryAt = null;
      await requestDrain(runtime);
    },

    removeCollectionDownloads: async (collectionId) => {
      const store = useOfflineStore.getState();
      const collection = store.collections[collectionId];
      if (!collection) return;
      const orphaned = collection.trackFileIds.filter(
        (fileId) => (store.refCounts[fileId] ?? 1) <= 1,
      );

      supersedeGeneration(runtime, "collection-remove");
      store.disableCollection(collectionId);
      await Promise.all(
        orphaned.map((fileId) => deleteTrackIfUnreferenced(runtime, fileId)),
      );
      await withDeadline(
        dependencies.database.deleteCollection(collectionId),
        DATABASE_TIMEOUT_MS,
        "IndexedDB collection delete",
        () => dependencies.database.resetConnection?.(),
      );
      runtime.storedTrackIds.clear();
      updateCollectionProgress();
      void requestDrain(runtime);
    },

    removeAllDownloads: async () => {
      supersedeGeneration(runtime, "remove-all");
      runtime.drainRequested = false;
      if (runtime.retryTimer) {
        clearTimeout(runtime.retryTimer);
        runtime.retryTimer = null;
      }
      runtime.databaseRecoveryAttempt = 0;
      runtime.databaseRecoveryAt = null;
      await withDeadline(
        dependencies.database.clearAll(),
        DATABASE_TIMEOUT_MS,
        "IndexedDB clear",
        () => dependencies.database.resetConnection?.(),
      );
      usePlayerStore.getState().clearCache();
      useOfflineStore.getState().clearAll();
      useOfflineStore.persist.clearStorage();
    },
  };
}

export const offlineDownloadManager = createOfflineDownloadManager();

export function startOfflineDownloads(): () => void {
  return offlineDownloadManager.start();
}
