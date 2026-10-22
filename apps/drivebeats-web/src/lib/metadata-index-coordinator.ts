import { create } from "zustand";
import { isSupportedAudioFile } from "@/lib/audio";
import {
  loadBackgroundProgress,
  saveBackgroundProgress,
} from "@/lib/background-progress-db";
import { metadataEnvironmentKey } from "@/lib/drive-metadata-reader";
import {
  acquireDriveBackgroundLeader,
  DriveDeferredError,
  getDriveCoordinationStatus,
  isDriveBackgroundFenceCurrent,
} from "@/lib/drive-request-scheduler";
import {
  getKnownTrackDescriptorRevision,
  registerKnownFolder,
  resolveKnownTrack,
  verifyKnownCollections,
} from "@/lib/known-track-resolver";
import {
  getMetadataBudgetRetryAt,
  isMetadataBudgetDeferred,
  METADATA_PARSER_VERSION,
  METADATA_POLICY_VERSION,
} from "@/lib/metadata-cache-types";
import { buildMetadataCoverage } from "@/lib/metadata-coverage";
import { getLocalMetadataAccountId } from "@/lib/metadata-local-account";
import { buildPersistedMetadataCoverage } from "@/lib/persisted-metadata-coverage";
import {
  ensureTrackMetadata,
  getTrackMetadataRetryAt,
  getTrackMetadataState,
  useMetadataLoaderStore,
} from "@/lib/track-metadata-loader";
import { useAuthStore } from "@/stores/auth-store";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";
import {
  getLibrarySearchImportsSignature,
  useLibrarySearchStore,
} from "@/stores/library-search-store";
import { useLibraryStore } from "@/stores/library-store";
import { usePlaylistStore } from "@/stores/playlist-store";
import { type DriveFile, FOLDER_MIME, type FolderEntry } from "@/types";

export const useMetadataIndexStore = create<{
  revision: number;
  running: boolean;
  pauseReason: string | null;
  retryAt: number;
}>(() => ({ revision: 0, running: false, pauseReason: null, retryAt: 0 }));
const visible = new Map<Element, { track: DriveFile; visible: boolean }>();
let folderTracks: DriveFile[] = [];
let observer: IntersectionObserver | null = null;
let controller: AbortController | null = null;
let wake: (() => void) | null = null;
let persistedRevision = 0;
let priorityRevision = 0;

function isMetadataTrack(track: DriveFile) {
  return track.mimeType !== FOLDER_MIME && isSupportedAudioFile(track);
}

export function observeVisibleMetadataTrack(
  element: Element,
  track: DriveFile,
) {
  if (!isMetadataTrack(track)) return () => {};
  visible.set(element, { track, visible: false });
  if (typeof IntersectionObserver !== "undefined") {
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const item = visible.get(entry.target);
        if (item && item.visible !== entry.isIntersecting) {
          item.visible = entry.isIntersecting;
          priorityRevision++;
        }
      }
      wake?.();
    });
    observer.observe(element);
  }
  return () => {
    observer?.unobserve(element);
    visible.delete(element);
    priorityRevision++;
  };
}
export function setCurrentMetadataFolder(
  stack: FolderEntry[],
  tracks: DriveFile[],
) {
  const accountId = useAuthStore.getState().user?.id;
  const active = tracks.filter(isMetadataTrack);
  if (accountId) registerKnownFolder(accountId, stack, tracks);
  folderTracks = active;
  priorityRevision++;
  wake?.();
  return () => {
    if (folderTracks === active) folderTracks = [];
  };
}
export function stopMetadataIndex() {
  controller?.abort();
  controller = null;
  wake?.();
  useMetadataIndexStore.setState({
    running: false,
    pauseReason: null,
    retryAt: 0,
  });
}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      if (wake === done) wake = null;
      resolve();
    };
    const timer = setTimeout(done, Math.max(100, ms));
    signal.addEventListener("abort", done, { once: true });
    wake = done;
    if (signal.aborted) done();
  });
}
interface NetworkHints extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}
function networkHints() {
  return (navigator as Navigator & { connection?: NetworkHints }).connection;
}
function automaticNetworkPauseReason() {
  const hints = networkHints();
  return hints?.saveData
    ? "data_saver"
    : ["slow-2g", "2g"].includes(hints?.effectiveType ?? "")
      ? "slow_connection"
      : null;
}

function currentAccount() {
  const auth = useAuthStore.getState();
  return auth.authStatus === "authenticated" && !auth.isLoggingOut
    ? auth.user?.id
    : undefined;
}
function coverageScope() {
  const accountId = getLocalMetadataAccountId();
  const search = useLibrarySearchStore.getState();
  const catalog = search.catalog;
  const signature = getLibrarySearchImportsSignature();
  const metadata = useId3MetadataStore.getState();
  return {
    accountId,
    catalog,
    signature,
    records: metadata.records,
    generation: metadata.generation,
    loaderRevision: useMetadataLoaderStore.getState().revision,
    persistedRevision,
    descriptorRevision: getKnownTrackDescriptorRevision(),
    complete: Boolean(
      accountId &&
        catalog?.userId === accountId &&
        !search.invalidated &&
        catalog.importsSignature === signature,
    ),
  };
}
type CoverageScope = ReturnType<typeof coverageScope>;
function sameCoverageBaseScope(a: CoverageScope, b: CoverageScope) {
  return (
    a.accountId === b.accountId &&
    a.catalog === b.catalog &&
    a.signature === b.signature &&
    a.generation === b.generation &&
    a.descriptorRevision === b.descriptorRevision &&
    a.complete === b.complete
  );
}
function sameCoverageScope(a: CoverageScope, b: CoverageScope) {
  return (
    sameCoverageBaseScope(a, b) &&
    a.records === b.records &&
    a.loaderRevision === b.loaderRevision &&
    a.persistedRevision === b.persistedRevision
  );
}
let observedBaseScope: CoverageScope | null = null;
let coverageScopeVersion = 0;
function observeCoverageScope(scope: CoverageScope) {
  if (!observedBaseScope || !sameCoverageBaseScope(observedBaseScope, scope)) {
    observedBaseScope = scope;
    coverageScopeVersion++;
  }
  return coverageScopeVersion;
}

let coverageAggregate: {
  scope: CoverageScope;
  coverage: Awaited<ReturnType<typeof buildPersistedMetadataCoverage>>;
  observedAt: number;
} | null = null;
let coverageFlight: { scope: CoverageScope; promise: Promise<void> } | null =
  null;
let coverageTimer: ReturnType<typeof setTimeout> | undefined;
function metadataStateFor(accountId: string | null, track: DriveFile) {
  const known = accountId ? resolveKnownTrack(accountId, track.id) : null;
  return known
    ? getTrackMetadataState(known)
    : { status: "missing" as const, freshness: "unknown" as const };
}
function refreshCoverageSoon() {
  if (coverageTimer) return;
  coverageTimer = setTimeout(() => {
    coverageTimer = undefined;
    void getMetadataIndexStatusAsync().catch(() => {});
  }, 250);
}

function unknownMetadataCoverage(total: number | null) {
  const unknown = buildMetadataCoverage(null, () => ({
    status: "missing",
    freshness: "unknown",
  }));
  return {
    ...unknown,
    total,
    remaining: total,
    unknown: total ?? 0,
    catalogComplete: total !== null,
  };
}

/** Cached/local counts only; coveragePending prevents stale aggregates claiming completion. */
export function getMetadataIndexStatus() {
  const scope = coverageScope();
  const { accountId, catalog, complete } = scope;
  const freshAggregate =
    coverageAggregate && sameCoverageScope(coverageAggregate.scope, scope)
      ? coverageAggregate
      : null;
  // Counts remain the last observed snapshot while tags warm within the same
  // account/catalog/version scope; completion still requires a fresh aggregate.
  const displayAggregate =
    coverageAggregate && sameCoverageBaseScope(coverageAggregate.scope, scope)
      ? coverageAggregate
      : null;
  const coverage =
    displayAggregate?.coverage ??
    unknownMetadataCoverage(complete ? (catalog?.tracks.length ?? 0) : null);
  const coveragePending = complete && !freshAggregate;
  const metadataSearchComplete =
    !coveragePending && coverage.metadataSearchComplete;
  const state = useMetadataIndexStore.getState();
  const coordination = accountId ? getDriveCoordinationStatus(accountId) : null;
  return {
    ...coverage,
    metadataSearchComplete,
    coveragePending,
    coverageScopeVersion: observeCoverageScope(scope),
    observedAt: displayAggregate?.observedAt ?? null,
    indexingState:
      !coveragePending && complete && coverage.remaining === 0
        ? coverage.unresolved
          ? "partial"
          : "complete"
        : state.running
          ? "running"
          : state.pauseReason
            ? "paused"
            : "idle",
    pauseReason: state.pauseReason,
    retryAfterMs: Math.max(
      0,
      state.retryAt - Date.now(),
      coordination?.retryAfterMs ?? 0,
      coordination?.metadataRetryAfterMs ?? 0,
    ),
    sessionOnlyCatalog: useLibrarySearchStore.getState().sessionOnly,
    catalogItemsDiscovered: useLibrarySearchStore.getState().buildProgress,
    coordinationAvailable: coordination?.available ?? false,
  };
}

/** One coalesced local scan; no Drive reads, shared across UI and page tools. */
export async function getMetadataIndexStatusAsync(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const scope = coverageScope();
  if (!scope.complete || !scope.accountId || !scope.catalog)
    return getMetadataIndexStatus();
  if (
    !coverageAggregate ||
    !sameCoverageScope(coverageAggregate.scope, scope)
  ) {
    // Finish the current local scan before starting another revision. Row jobs
    // can change quickly; they must never fan out concurrent full-Library scans.
    if (!coverageFlight) {
      const accountId = scope.accountId;
      const catalog = scope.catalog;
      const flight = { scope, promise: Promise.resolve() };
      flight.promise = buildPersistedMetadataCoverage(
        accountId,
        catalog.tracks,
        (track) => metadataStateFor(accountId, track),
      )
        .then((coverage) => {
          // Publish a useful snapshot even if another track finished while this
          // scan yielded. It remains pending until an exact revision catches up;
          // account/catalog/version changes still discard the entire snapshot.
          if (!sameCoverageBaseScope(scope, coverageScope())) return;
          coverageAggregate = { scope, coverage, observedAt: Date.now() };
          useMetadataIndexStore.setState((state) => ({
            revision: state.revision + 1,
          }));
        })
        .finally(() => {
          if (coverageFlight === flight) coverageFlight = null;
          if (controller && !sameCoverageScope(scope, coverageScope()))
            refreshCoverageSoon();
        });
      coverageFlight = flight;
    }
    const promise = coverageFlight.promise;
    if (!signal) await promise;
    else
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          cleanup();
          reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
        };
        const cleanup = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        void promise.then(
          () => {
            cleanup();
            resolve();
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
      });
  }
  signal?.throwIfAborted();
  return getMetadataIndexStatus();
}

interface ScanProgress {
  cursor: number;
  retryAt: number;
  completed?: string;
  blocked?: { code: string; trackId: string; retryAt: number };
}
function decodeProgress(value: unknown): ScanProgress {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return { cursor: value, retryAt: 0 };
  if (value && typeof value === "object") {
    const item = value as Partial<ScanProgress>;
    return {
      cursor:
        Number.isSafeInteger(item.cursor) && (item.cursor ?? -1) >= 0
          ? (item.cursor ?? 0)
          : 0,
      completed:
        typeof item.completed === "string" ? item.completed : undefined,
      blocked:
        item.blocked &&
        [
          "metadata_auth_required",
          "metadata_setup_error",
          "drive_auth_required",
        ].includes(item.blocked.code) &&
        typeof item.blocked.trackId === "string" &&
        Number.isFinite(item.blocked.retryAt)
          ? item.blocked
          : undefined,
      retryAt:
        typeof item.retryAt === "number" && Number.isFinite(item.retryAt)
          ? item.retryAt
          : 0,
    };
  }
  return { cursor: 0, retryAt: 0 };
}

/** Single worker per visible account; scheduler grants the profile-wide lease. */
export function startMetadataIndex() {
  if (controller) return () => {};
  const lifecycle = new AbortController();
  controller = lifecycle;
  // Provider remount may follow changes persisted by another tab while stopped.
  persistedRevision += 1;
  const poke = () => {
    wake?.();
    refreshCoverageSoon();
  };
  const unsubscribeMetadata =
    useId3MetadataStore.subscribe(refreshCoverageSoon);
  const unsubscribeLoader =
    useMetadataLoaderStore.subscribe(refreshCoverageSoon);
  refreshCoverageSoon();
  const unsubscribe = useAuthStore.subscribe(poke);
  const unsubscribeImports = useImportedDriveStore.subscribe(poke);
  const unsubscribeSearch = useLibrarySearchStore.subscribe(poke);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "drivebeats-metadata-updated" || !event.newValue) return;
    try {
      const { accountId } = JSON.parse(event.newValue) as {
        accountId?: string;
      };
      if (accountId !== getLocalMetadataAccountId()) return;
      persistedRevision += 1;
      poke();
    } catch {
      /* Ignore malformed local notifications. */
    }
  };
  const connection = networkHints();
  connection?.addEventListener("change", poke);
  window.addEventListener("storage", onStorage);
  window.addEventListener("online", poke);
  document.addEventListener("visibilitychange", poke);
  let retryAt = 0;
  let retryAccount: string | undefined;
  void (async () => {
    while (!lifecycle.signal.aborted) {
      const accountId = currentAccount();
      if (retryAccount !== accountId) {
        retryAccount = accountId;
        retryAt = 0;
      }
      if (
        !accountId ||
        document.visibilityState === "hidden" ||
        !navigator.onLine ||
        !useImportedDriveStore.persist.hasHydrated() ||
        automaticNetworkPauseReason()
      ) {
        useMetadataIndexStore.setState({
          running: false,
          pauseReason: !accountId
            ? null
            : !navigator.onLine
              ? "offline"
              : document.visibilityState === "hidden"
                ? "hidden"
                : !useImportedDriveStore.persist.hasHydrated()
                  ? "hydrating"
                  : automaticNetworkPauseReason(),
          retryAt: 0,
        });
        await sleep(2000, lifecycle.signal);
        continue;
      }
      // Waking for navigation/resume never grants permission to bypass backoff.
      if (retryAt > Date.now()) {
        await sleep(Math.min(2000, retryAt - Date.now()), lifecycle.signal);
        continue;
      }
      try {
        await useId3MetadataStore.getState().setAccount(accountId);
        if (accountId !== currentAccount() || lifecycle.signal.aborted)
          continue;
        const lease = new AbortController();
        const cancelAccount = useAuthStore.subscribe(() => {
          if (currentAccount() !== accountId) lease.abort();
        });
        const connectionChanged = () => {
          if (automaticNetworkPauseReason()) lease.abort();
          poke();
        };
        connection?.addEventListener("change", connectionChanged);
        const leaseSignal = AbortSignal.any([lifecycle.signal, lease.signal]);
        try {
          await acquireDriveBackgroundLeader(
            accountId,
            leaseSignal,
            async (fence, signal) => {
              const valid = () =>
                !signal.aborted &&
                accountId === currentAccount() &&
                !automaticNetworkPauseReason() &&
                isDriveBackgroundFenceCurrent(accountId, fence);
              let catalogTask: Promise<boolean> | null = null;
              let catalogAttemptAt = 0;
              let progress: ScanProgress = { cursor: 0, retryAt: 0 };
              let progressKey = "";
              let scanStamp = "";
              let libraryRemaining = 0;
              let priorityOffset = 0;
              let priorities: DriveFile[] = [];
              let visibleIds = new Set<string>();
              let observedPriorities = -1;
              let trustedCompletion = false;
              let blockedAuthToken = useAuthStore.getState().accessToken;
              let blockedProbe: DriveFile | undefined;
              const retries = new Map<
                string,
                { track: DriveFile; at: number }
              >();
              while (valid()) {
                const search = useLibrarySearchStore.getState();
                if (
                  !catalogTask &&
                  Date.now() >= catalogAttemptAt &&
                  (!search.hydrated || search.isStale())
                ) {
                  catalogAttemptAt = Date.now() + 30_000;
                  // Do not await: proven visible/folder tracks can load during a cold catalog.
                  catalogTask = search
                    .ensureReady(signal, { background: true })
                    .catch(() => false)
                    .finally(() => {
                      catalogTask = null;
                      poke();
                    });
                }
                if (
                  useLibraryStore.getState().isCloudHydrated &&
                  usePlaylistStore.getState().isCloudHydrated
                )
                  verifyKnownCollections(accountId);
                const latestSearch = useLibrarySearchStore.getState();
                const catalog = latestSearch.catalog;
                const signature = getLibrarySearchImportsSignature();
                const tracks =
                  catalog?.userId === accountId &&
                  catalog.importsSignature === signature &&
                  !latestSearch.invalidated
                    ? catalog.tracks
                    : [];
                const nextKey = `metadata:${accountId}:${signature}:${catalog?.fetchedAt ?? 0}`;
                const nextStamp = `${METADATA_PARSER_VERSION}:${METADATA_POLICY_VERSION}:${getKnownTrackDescriptorRevision()}:${useId3MetadataStore.getState().generation}`;
                if (progressKey !== nextKey) {
                  progressKey = nextKey;
                  progress = decodeProgress(
                    await loadBackgroundProgress<unknown>(progressKey),
                  );
                  if (!valid()) break;
                  progress.cursor %= Math.max(1, tracks.length);
                  libraryRemaining = tracks.length;
                  trustedCompletion = false;
                  retries.clear();
                }
                if (scanStamp !== nextStamp) {
                  scanStamp = nextStamp;
                  libraryRemaining = tracks.length;
                  trustedCompletion = false;
                  observedPriorities = -1;
                }
                if (progress.completed === scanStamp && !trustedCompletion) {
                  const status = getMetadataIndexStatus();
                  // On reopening, validate completion against the same durable cache.
                  if (status.coveragePending) {
                    refreshCoverageSoon();
                    await sleep(250, signal);
                    continue;
                  }
                  if (status.remaining === 0) {
                    libraryRemaining = 0;
                    trustedCompletion = true;
                  } else progress.completed = undefined;
                }
                if (observedPriorities !== priorityRevision) {
                  const preferred = [...visible.values()]
                    .filter((item) => item.visible)
                    .map((item) => item.track);
                  visibleIds = new Set(preferred.map((track) => track.id));
                  priorities = [
                    ...new Map(
                      [...preferred, ...folderTracks].map((track) => [
                        track.id,
                        track,
                      ]),
                    ).values(),
                  ];
                  priorityOffset = 0;
                  observedPriorities = priorityRevision;
                }
                if (progress.blocked) {
                  const blocked = progress.blocked;
                  const authChanged =
                    useAuthStore.getState().accessToken !== blockedAuthToken;
                  if (!authChanged && blocked.retryAt > Date.now()) {
                    useMetadataIndexStore.setState({
                      running: false,
                      pauseReason: blocked.code,
                      retryAt: blocked.retryAt,
                    });
                    await sleep(
                      Math.min(30_000, blocked.retryAt - Date.now()),
                      signal,
                    );
                    continue;
                  }
                  blockedProbe = resolveKnownTrack(
                    accountId,
                    blocked.trackId,
                  )?.track;
                  progress.blocked = undefined;
                  progress.retryAt = 0;
                }
                const coordination = getDriveCoordinationStatus(accountId);
                const waitUntil = Math.max(
                  progress.retryAt,
                  coordination.cooldownUntil,
                  coordination.metadataCooldownUntil ?? 0,
                );
                if (waitUntil > Date.now()) {
                  const pacing = waitUntil - Date.now() <= 2000;
                  useMetadataIndexStore.setState({
                    running: pacing,
                    pauseReason: pacing
                      ? null
                      : Math.max(
                            coordination.cooldownUntil,
                            coordination.metadataCooldownUntil ?? 0,
                          ) > Date.now()
                        ? "rate_limited"
                        : "waiting",
                    retryAt: waitUntil,
                  });
                  await sleep(Math.min(2000, waitUntil - Date.now()), signal);
                  continue;
                }
                let attempted = false;
                let checked = 0;
                let globalPause: string | null = null;
                while (valid() && checked < 100) {
                  let track: DriveFile | undefined;
                  if (blockedProbe) {
                    track = blockedProbe;
                    blockedProbe = undefined;
                  } else if (priorityOffset < priorities.length)
                    track = priorities[priorityOffset++];
                  else if (libraryRemaining > 0) {
                    track = tracks[progress.cursor];
                    progress.cursor =
                      (progress.cursor + 1) % Math.max(1, tracks.length);
                    libraryRemaining--;
                  } else {
                    const due = [...retries.values()].find(
                      (item) => item.at <= Date.now(),
                    );
                    if (due) {
                      track = due.track;
                      retries.delete(track.id);
                    }
                  }
                  if (!track) break;
                  checked++;
                  const known = resolveKnownTrack(accountId, track.id);
                  if (!known) {
                    retries.set(track.id, { track, at: Date.now() + 30_000 });
                    continue;
                  }
                  const cached = await useId3MetadataStore
                    .getState()
                    .peekRecord(known.track, metadataEnvironmentKey());
                  if (!valid()) break;
                  if (cached.freshness === "current" && cached.record) {
                    if (!isMetadataBudgetDeferred(cached.record)) {
                      retries.delete(track.id);
                      continue;
                    }
                    const at = getMetadataBudgetRetryAt(cached.record);
                    if (at > Date.now()) {
                      retries.set(track.id, { track, at });
                      continue;
                    }
                  }
                  const retryAt = getTrackMetadataRetryAt(known);
                  if (retryAt > Date.now()) {
                    retries.set(track.id, { track, at: retryAt });
                    continue;
                  }
                  useMetadataIndexStore.setState({
                    running: true,
                    pauseReason: null,
                    retryAt: 0,
                  });
                  const result = await ensureTrackMetadata(known, {
                    signal,
                    priority: visibleIds.has(track.id)
                      ? "visible"
                      : "background",
                    deadline: Date.now() + 15_000,
                  });
                  if (!valid()) break;
                  attempted = true;
                  const terminal =
                    result.metadata.freshness === "current" &&
                    ["ready", "no_target_tags", "unresolved"].includes(
                      result.metadata.status,
                    );
                  const code = result.metadata.error?.code;
                  if (terminal) retries.delete(track.id);
                  else
                    retries.set(track.id, {
                      track,
                      at:
                        getTrackMetadataRetryAt(known) ||
                        Date.now() +
                          (code === "preempted"
                            ? 0
                            : (result.metadata.error?.retryAfterMs ?? 30_000)),
                    });
                  // Endpoint sign-in/setup failures belong to metadata as a whole,
                  // not to every file. Recheck one affected track after a bounded
                  // pause (or a real auth-token change), without walking the catalog.
                  const metadataBlocked = [
                    "metadata_auth_required",
                    "metadata_setup_error",
                    "drive_auth_required",
                  ].includes(code ?? "");
                  if (!terminal && metadataBlocked) {
                    progress.blocked = {
                      code: code as string,
                      trackId: track.id,
                      retryAt: Date.now() + 5 * 60_000,
                    };
                    blockedAuthToken = useAuthStore.getState().accessToken;
                  }
                  globalPause =
                    !terminal &&
                    (metadataBlocked ||
                      [
                        "rate_limited",
                        "offline",
                        "coordination_unavailable",
                      ].includes(code ?? "") ||
                      (code === "budget_exceeded" &&
                        result.metadata.error?.budgetScope === "background"))
                      ? (code ?? null)
                      : null;
                  progress.retryAt =
                    progress.blocked?.retryAt ??
                    Date.now() +
                      (globalPause
                        ? Math.max(
                            1000,
                            result.metadata.error?.retryAfterMs ?? 2000,
                          )
                        : 250);
                  break;
                }
                if (!valid()) break;
                if (
                  libraryRemaining === 0 &&
                  priorityOffset >= priorities.length &&
                  retries.size === 0
                ) {
                  progress.completed = scanStamp;
                  trustedCompletion = true;
                }
                if (checked)
                  await saveBackgroundProgress(progressKey, progress, {
                    signal,
                    isCurrent: () =>
                      valid() &&
                      signature === getLibrarySearchImportsSignature(),
                  });
                if (!valid()) break;
                const pending =
                  libraryRemaining > 0 || priorityOffset < priorities.length;
                const status = getMetadataIndexStatus();
                useMetadataIndexStore.setState((state) => ({
                  revision: state.revision + (attempted ? 1 : 0),
                  running:
                    !globalPause &&
                    (pending ||
                      attempted ||
                      Boolean(catalogTask) ||
                      status.coveragePending),
                  pauseReason:
                    globalPause ??
                    (!pending && retries.size ? "waiting" : null),
                  retryAt: progress.retryAt,
                }));
                const nearestRetry = Math.min(
                  ...[...retries.values()].map((item) => item.at),
                );
                const delay =
                  progress.retryAt > Date.now()
                    ? Math.min(2000, progress.retryAt - Date.now())
                    : pending
                      ? 100
                      : retries.size
                        ? Math.max(
                            100,
                            Math.min(30_000, nearestRetry - Date.now()),
                          )
                        : 30_000;
                await sleep(delay, signal);
              }
              // Cancellation belongs to the shared catalog's consumer; it releases promptly.
              await catalogTask;
            },
          );
        } finally {
          cancelAccount();
          connection?.removeEventListener("change", connectionChanged);
          lease.abort();
        }
      } catch (error) {
        if (!lifecycle.signal.aborted && accountId === currentAccount()) {
          const delay =
            error instanceof DriveDeferredError
              ? Math.max(1000, error.retryAfterMs)
              : 5000;
          retryAt = Date.now() + delay;
          useMetadataIndexStore.setState({
            running: false,
            pauseReason:
              error instanceof DriveDeferredError
                ? error.reason
                : "temporarily_unavailable",
            retryAt,
          });
        }
      }
      await sleep(2000, lifecycle.signal);
    }
  })().finally(() => {
    unsubscribe();
    unsubscribeImports();
    unsubscribeSearch();
    unsubscribeMetadata();
    unsubscribeLoader();
    window.removeEventListener("online", poke);
    window.removeEventListener("storage", onStorage);
    connection?.removeEventListener("change", poke);
    document.removeEventListener("visibilitychange", poke);
    if (controller === lifecycle) {
      controller = null;
      useMetadataIndexStore.setState({
        running: false,
        pauseReason: null,
        retryAt: 0,
      });
    }
  });
  return () => {
    if (controller === lifecycle) stopMetadataIndex();
    else lifecycle.abort();
  };
}
