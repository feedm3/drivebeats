import { create } from "zustand";
import {
  MetadataReadError,
  metadataEnvironmentKey,
  readDriveTrackMetadata,
} from "@/lib/drive-metadata-reader";
import {
  createDriveRequestBudget,
  type DriveBudgetScope,
  DriveDeferredError,
  DrivePreemptedError,
  type DriveRequestBudget,
  type DriveRequestPriority,
} from "@/lib/drive-request-scheduler";
import { getGoogleDriveFileMetadata } from "@/lib/google-api";
import { extractId3MetadataResult, type Id3Metadata } from "@/lib/id3-metadata";
import {
  assertKnownTrack,
  type KnownTrack,
  updateKnownTrackDescriptor,
} from "@/lib/known-track-resolver";
import {
  getMetadataBudgetRetryAt,
  getMetadataBudgetRetryCount,
  getMetadataFingerprint,
  isMetadataBudgetDeferred,
  METADATA_RANGE_STRATEGY_VERSION,
  type MetadataFreshness,
  type MetadataOutcome,
} from "@/lib/metadata-cache-types";
import { useAuthStore } from "@/stores/auth-store";
import { useId3MetadataStore } from "@/stores/id3-metadata-store";
import type { DriveFile } from "@/types";

export interface MetadataView {
  status:
    | "missing"
    | "queued"
    | "loading"
    | "ready"
    | "no_target_tags"
    | "unresolved"
    | "deferred"
    | "error"
    | "unavailable";
  freshness: MetadataFreshness;
  tags?: Id3Metadata;
  checkedAt?: number;
  loadedVia?: "local_blob" | "drive_range";
  reason?: string;
  error?: {
    code: string;
    retryable: boolean;
    retryAfterMs?: number;
    budgetScope?: DriveBudgetScope;
  };
}
export interface MetadataLoadResult {
  metadata: MetadataView;
  loadedNow: boolean;
}
export interface MetadataBlobSource {
  readonly accountId: string;
  readonly fileId: string;
  readonly modifiedTime: string;
  readonly size: string;
}
interface BoundMetadataBlob {
  blob: Blob;
  source: MetadataBlobSource;
}
/** A caller-supplied Blob proves only the immutable descriptor of its source. */
export function isMetadataBlobCurrent(
  known: KnownTrack,
  blob: Blob,
  source: MetadataBlobSource,
) {
  const fingerprint = getMetadataFingerprint(known.track);
  return Boolean(
    fingerprint &&
      source.accountId === known.accountId &&
      source.fileId === known.track.id &&
      Number.isSafeInteger(Number(source.size)) &&
      Number(source.size) > 0 &&
      blob.size === Number(source.size) &&
      fingerprint === getMetadataFingerprint({ ...source, id: source.fileId }),
  );
}
interface Subscriber {
  priority: DriveRequestPriority;
  budget: DriveRequestBudget;
}
interface Flight {
  known: KnownTrack;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  promise: Promise<MetadataLoadResult>;
  blob?: BoundMetadataBlob;
  budgets: Set<DriveRequestBudget>;
  budget?: DriveRequestBudget;
}
const flights = new Map<string, Flight>();
const statuses = new Map<string, MetadataView>();
const statusScopes = new Map<string, string>();
const retryAt = new Map<string, number>();
export const useMetadataLoaderStore = create<{ revision: number }>(() => ({
  revision: 0,
}));
const rank: Record<DriveRequestPriority, number> = {
  playback: 0,
  navigation: 1,
  prefetch: 2,
  visible: 3,
  background: 4,
  offline: 5,
};
const keyFor = (known: KnownTrack) => `${known.accountId}:${known.track.id}`;
function changed() {
  useMetadataLoaderStore.setState((state) => ({
    revision: state.revision + 1,
  }));
}
function setStatus(known: KnownTrack, view: MetadataView) {
  if (!assertKnownTrack(known)) return;
  statuses.set(keyFor(known), view);
  statusScopes.set(keyFor(known), known.scopeKey);
  if (statuses.size > 20000)
    statuses.delete(statuses.keys().next().value as string);
  changed();
}
export function getTrackMetadataRetryAt(known: KnownTrack): number {
  const store = useId3MetadataStore.getState();
  const saved =
    store.accountId === known.accountId
      ? store.getRecord(known.track, metadataEnvironmentKey())
      : null;
  return Math.max(
    retryAt.get(`${keyFor(known)}:${known.scopeKey}`) ?? 0,
    saved?.record && saved.freshness === "current"
      ? getMetadataBudgetRetryAt(saved.record)
      : 0,
  );
}
export function getTrackMetadataState(known: KnownTrack): MetadataView {
  if (!assertKnownTrack(known))
    return { status: "unavailable", freshness: "unknown" };
  const store = useId3MetadataStore.getState();
  if (store.accountId !== known.accountId)
    return { status: "missing", freshness: "unknown" };
  const { record, freshness } = store.getRecord(
    known.track,
    metadataEnvironmentKey(),
  );
  if (record && (freshness === "current" || freshness === "stale")) {
    const deferred =
      freshness === "current" && isMetadataBudgetDeferred(record);
    return {
      status: deferred ? "deferred" : record.status,
      freshness,
      tags: record.tags,
      checkedAt: record.checkedAt,
      loadedVia: record.loadedVia,
      reason: record.reason,
      ...(record.reason
        ? {
            error: {
              code: record.reason,
              retryable: deferred,
              ...(deferred
                ? {
                    retryAfterMs: Math.max(
                      0,
                      getMetadataBudgetRetryAt(record) - Date.now(),
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };
  }
  return (
    (statusScopes.get(keyFor(known)) === known.scopeKey
      ? statuses.get(keyFor(known))
      : undefined) ?? { status: "missing", freshness }
  );
}

function assertCurrent(flight: Flight) {
  flight.controller.signal.throwIfAborted();
  if (!assertKnownTrack(flight.known))
    throw new MetadataReadError("scope_changed", true);
}
function getPriority(flight: Flight) {
  return (
    [...flight.subscribers].sort(
      (a, b) => rank[a.priority] - rank[b.priority],
    )[0]?.priority ?? "background"
  );
}
/** Each live consumer's allowance sees the same actual requests, never duplicated network work. */
function sharedBudget(flight: Flight): DriveRequestBudget {
  const values = { requestsUsed: 0, bytesRead: 0, bytesReserved: 0 };
  const budgets = () => [
    ...new Set([...flight.subscribers].map((subscriber) => subscriber.budget)),
  ];
  return {
    get maxRequests() {
      return (
        values.requestsUsed +
        Math.min(
          ...budgets().map(
            (budget) => budget.maxRequests - budget.requestsUsed,
          ),
        )
      );
    },
    get maxBytes() {
      return (
        values.bytesRead +
        values.bytesReserved +
        Math.min(
          ...budgets().map(
            (budget) =>
              budget.maxBytes - budget.bytesRead - budget.bytesReserved,
          ),
        )
      );
    },
    get requestsUsed() {
      return values.requestsUsed;
    },
    set requestsUsed(value) {
      const delta = value - values.requestsUsed;
      for (const budget of flight.budgets) budget.requestsUsed += delta;
      values.requestsUsed = value;
    },
    get bytesRead() {
      return values.bytesRead;
    },
    set bytesRead(value) {
      const delta = value - values.bytesRead;
      for (const budget of flight.budgets) budget.bytesRead += delta;
      values.bytesRead = value;
    },
    get bytesReserved() {
      return values.bytesReserved;
    },
    set bytesReserved(value) {
      const delta = value - values.bytesReserved;
      for (const budget of flight.budgets) budget.bytesReserved += delta;
      values.bytesReserved = value;
    },
  };
}
function isMp3(known: KnownTrack) {
  return (
    ["audio/mpeg", "audio/mp3"].includes(known.originalMimeType ?? "") ||
    /\.mp3$/i.test(known.track.name)
  );
}
async function run(flight: Flight): Promise<MetadataLoadResult> {
  const known = flight.known;
  const signal = flight.controller.signal;
  assertCurrent(flight);
  const hydration = useId3MetadataStore.getState().setAccount(known.accountId);
  const generation = useId3MetadataStore.getState().generation;
  await hydration;
  assertCurrent(flight);
  if (
    generation !== useId3MetadataStore.getState().generation ||
    useId3MetadataStore.getState().accountId !== known.accountId
  )
    throw new MetadataReadError("scope_changed", true);
  useId3MetadataStore.getState().observeDescriptor(known.track);
  await useId3MetadataStore
    .getState()
    .loadRecord(known.track, metadataEnvironmentKey());
  assertCurrent(flight);
  const budget = sharedBudget(flight);
  flight.budget = budget;
  const requestOptions = {
    accountId: known.accountId,
    priority: () => getPriority(flight),
    signal,
    budget,
    maxAttempts: 1,
  };
  const cached = getTrackMetadataState(known);
  const pendingRetry = getTrackMetadataRetryAt(known);
  if (!flight.blob && pendingRetry > Date.now())
    return {
      metadata: {
        ...cached,
        error: {
          code: cached.error?.code ?? "temporarily_unavailable",
          retryable: cached.error?.retryable ?? true,
          retryAfterMs: pendingRetry - Date.now(),
        },
      },
      loadedNow: false,
    };
  if (
    cached.freshness === "current" &&
    ["ready", "no_target_tags", "unresolved"].includes(cached.status) &&
    !(cached.status === "unresolved" && flight.blob)
  )
    return { metadata: cached, loadedNow: false };
  setStatus(known, { status: "loading", freshness: cached.freshness });
  let outcome: MetadataOutcome;
  let descriptor = known.track;
  let checks = 0;
  async function checkDescriptor() {
    assertCurrent(flight);
    const auth = useAuthStore.getState();
    if (typeof navigator !== "undefined" && !navigator.onLine)
      throw new MetadataReadError("offline", true);
    if (
      auth.authStatus !== "authenticated" ||
      auth.user?.id !== known.accountId ||
      auth.isLoggingOut
    )
      throw new MetadataReadError("drive_auth_required", true);
    if (++checks > 2) throw new MetadataReadError("budget_exceeded");
    const token = await useAuthStore.getState().getValidAccessToken();
    assertCurrent(flight);
    if (!token) throw new MetadataReadError("drive_auth_required", true);
    const response = await getGoogleDriveFileMetadata(
      known.track.id,
      token,
      {
        fields: "id,name,mimeType,size,modifiedTime",
        supportsAllDrives: "true",
      },
      { ...requestOptions, maxBytes: 16384 },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new MetadataReadError(
        response.headers.get("X-DriveBeats-Rate-Limited") === "true"
          ? "rate_limited"
          : response.status === 401
            ? "drive_auth_required"
            : response.status === 404
              ? "not_found"
              : response.status === 403
                ? "permission_denied"
                : response.status === 429
                  ? "rate_limited"
                  : "network_error",
        true,
      );
    }
    const data = (await response.json()) as DriveFile;
    assertCurrent(flight);
    if (
      data.id !== known.track.id ||
      !data.name ||
      !data.mimeType ||
      !getMetadataFingerprint(data)
    )
      throw new MetadataReadError("version_unknown", true);
    return data;
  }
  try {
    if (
      typeof navigator !== "undefined" &&
      !navigator.onLine &&
      (!known.track.modifiedTime || !known.track.size)
    ) {
      const { getTrack } = await import("@/lib/offline-db");
      const stored = await getTrack(known.track.id).catch(() => undefined);
      assertCurrent(flight);
      if (
        stored?.modifiedTime &&
        (!known.track.modifiedTime ||
          known.track.modifiedTime === stored.modifiedTime)
      ) {
        const localDescriptor = {
          ...known.track,
          modifiedTime: stored.modifiedTime,
          size: String(stored.sizeBytes),
          mimeType: stored.mimeType,
        };
        if (updateKnownTrackDescriptor(known, localDescriptor)) {
          descriptor = localDescriptor;
          useId3MetadataStore.getState().observeDescriptor(descriptor);
        }
      }
    }
    // This lookup reads existing session/offline audio only, and never starts a download.
    const { getAvailablePlaybackBlob } = await import("@/stores/player-store");
    const supplied = flight.blob;
    const blob =
      (supplied && isMetadataBlobCurrent(known, supplied.blob, supplied.source)
        ? supplied.blob
        : undefined) ??
      (await getAvailablePlaybackBlob(known.track.id, known.track));
    assertCurrent(flight);
    if (!blob && !getMetadataFingerprint(descriptor)) {
      descriptor = await checkDescriptor();
      if (!updateKnownTrackDescriptor(known, descriptor))
        throw new MetadataReadError("scope_changed", true);
      useId3MetadataStore.getState().observeDescriptor(descriptor);
      await useId3MetadataStore
        .getState()
        .loadRecord(descriptor, metadataEnvironmentKey());
      const existing = getTrackMetadataState(known);
      if (
        existing.freshness === "current" &&
        ["ready", "no_target_tags", "unresolved"].includes(existing.status)
      )
        return { metadata: existing, loadedNow: false };
    }
    if (blob) {
      outcome = await extractId3MetadataResult(blob);
      assertCurrent(flight);
      if (
        supplied &&
        blob === supplied.blob &&
        !isMetadataBlobCurrent(known, blob, supplied.source)
      )
        throw new MetadataReadError("version_changed", true);
    } else if (!isMp3(known)) {
      outcome = {
        status: "unresolved",
        reason: "unsupported_format",
        loadedVia: "drive_range",
      };
    } else {
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw new MetadataReadError("offline", true);
      // A proven catalog/collection descriptor already anchors these bytes.
      // Verify that exact version after reading, before publishing any tags.
      // Incomplete descriptors were strengthened above; do not re-fetch an
      // unchanged descriptor solely to start a second version check.
      if (!updateKnownTrackDescriptor(known, descriptor))
        throw new MetadataReadError("scope_changed", true);
      useId3MetadataStore.getState().observeDescriptor(descriptor);
      const existing = getTrackMetadataState(known);
      if (
        existing.freshness === "current" &&
        ["ready", "no_target_tags", "unresolved"].includes(existing.status)
      )
        return { metadata: existing, loadedNow: false };
      // Strengthening a descriptor can reveal a saved cooldown that was not
      // current at entry. Do not bypass it with another media read.
      if (
        existing.status === "deferred" &&
        getTrackMetadataRetryAt(known) > Date.now()
      )
        return { metadata: existing, loadedNow: false };
      const token = await useAuthStore.getState().getValidAccessToken();
      assertCurrent(flight);
      if (!token) throw new MetadataReadError("drive_auth_required", true);
      if (!isMp3(known))
        outcome = {
          status: "unresolved",
          reason: "unsupported_format",
          loadedVia: "drive_range",
        };
      else {
        const validateReadVersion = async () => {
          const after = await checkDescriptor();
          if (
            getMetadataFingerprint(after) !== getMetadataFingerprint(descriptor)
          ) {
            updateKnownTrackDescriptor(known, after);
            throw new MetadataReadError("version_changed", true);
          }
        };
        // Do not spend the last caller allowance on bytes that cannot be
        // validated. The reader may still need more than one bounded range.
        if (budget.maxRequests - budget.requestsUsed < 2)
          throw new DriveDeferredError(
            "budget_exceeded",
            0,
            undefined,
            "consumer",
          );
        outcome = await readDriveTrackMetadata({
          fileId: known.track.id,
          size: Number(descriptor.size),
          accessToken: token,
          signal,
          requestOptions,
          assertCurrent: () => assertCurrent(flight),
          refreshAccessToken: async () => {
            const refreshed = await useAuthStore
              .getState()
              .refreshAccessToken();
            assertCurrent(flight);
            return refreshed
              ? useAuthStore.getState().getValidAccessToken()
              : null;
          },
        }).catch(async (error: unknown) => {
          if (
            error instanceof MetadataReadError &&
            error.code === "version_changed"
          ) {
            // A size mismatch can stop the range before the final validator.
            // Strengthen the descriptor so the next bounded attempt can recover.
            const current = await checkDescriptor();
            updateKnownTrackDescriptor(known, current);
            useId3MetadataStore.getState().observeDescriptor(current);
          } else if (
            error instanceof MetadataReadError &&
            !error.retryable &&
            [
              "unsupported_format",
              "budget_exceeded",
              "range_unsupported",
              "parse_error",
            ].includes(error.code)
          ) {
            // A durable decoding/reading-limit result needs the same version
            // proof as successful tags; bytes may belong to a changed file.
            await validateReadVersion();
          }
          throw error;
        });
        await validateReadVersion();
      }
    }
  } catch (error) {
    if (
      error instanceof MetadataReadError &&
      !error.retryable &&
      [
        "unsupported_format",
        "budget_exceeded",
        "range_unsupported",
        "parse_error",
      ].includes(error.code)
    ) {
      const previous = useId3MetadataStore
        .getState()
        .getRecord(descriptor, metadataEnvironmentKey());
      outcome = {
        status: "unresolved",
        reason: error.code,
        loadedVia: "drive_range",
        ...(error.code === "budget_exceeded"
          ? {
              rangeStrategyVersion: METADATA_RANGE_STRATEGY_VERSION,
              retryCount:
                previous.freshness === "current" &&
                previous.record &&
                isMetadataBudgetDeferred(previous.record)
                  ? Math.min(
                      7,
                      getMetadataBudgetRetryCount(previous.record) + 1,
                    )
                  : 1,
            }
          : {}),
        ...(error.code === "range_unsupported"
          ? { environmentKey: metadataEnvironmentKey() }
          : {}),
      };
    } else {
      const deferred =
        error instanceof DriveDeferredError ||
        error instanceof DrivePreemptedError ||
        signal.aborted;
      const code =
        error instanceof DriveDeferredError
          ? error.reason
          : error instanceof DrivePreemptedError
            ? "preempted"
            : error instanceof MetadataReadError
              ? error.code
              : signal.aborted
                ? "cancelled"
                : "network_error";
      const view: MetadataView = {
        status: deferred ? "deferred" : "error",
        freshness: cached.freshness,
        error: {
          code,
          ...(error instanceof DriveDeferredError && error.budgetScope
            ? { budgetScope: error.budgetScope }
            : {}),
          retryable:
            ["permission_denied", "not_found"].includes(code) ||
            !(error instanceof MetadataReadError) ||
            error.retryable,
          retryAfterMs:
            error instanceof DriveDeferredError
              ? error.retryAfterMs
              : ["permission_denied", "not_found"].includes(code)
                ? 5 * 60_000
                : code === "preempted" || code === "cancelled"
                  ? 0
                  : code === "offline"
                    ? undefined
                    : 30_000,
        },
      };
      if (!signal.aborted)
        retryAt.set(
          `${keyFor(known)}:${known.scopeKey}`,
          Date.now() + (view.error?.retryAfterMs ?? 30000),
        );
      setStatus(known, view);
      return { metadata: view, loadedNow: false };
    }
  }
  assertCurrent(flight);
  await useId3MetadataStore
    .getState()
    .putRecord(descriptor, outcome, generation);
  assertCurrent(flight);
  statuses.delete(keyFor(known));
  changed();
  return { metadata: getTrackMetadataState(known), loadedNow: true };
}

export function ensureTrackMetadata(
  known: KnownTrack,
  options: {
    signal?: AbortSignal;
    priority?: DriveRequestPriority;
    deadline?: number;
    budget?: DriveRequestBudget;
    blob?: BoundMetadataBlob;
  } = {},
): Promise<MetadataLoadResult> {
  if (!assertKnownTrack(known))
    return Promise.resolve({
      metadata: { status: "unavailable", freshness: "unknown" },
      loadedNow: false,
    });
  const key = keyFor(known);
  let flight = flights.get(key);
  if (flight && !assertKnownTrack(flight.known)) flight.controller.abort();
  if (!flight || flight.controller.signal.aborted) {
    flight = {
      known,
      controller: new AbortController(),
      subscribers: new Set(),
      budgets: new Set(),
      promise: Promise.resolve({
        metadata: { status: "queued", freshness: "unknown" },
        loadedNow: false,
      }),
    };
    const activeFlight = flight;
    activeFlight.promise = Promise.resolve()
      .then(() => run(activeFlight))
      .finally(() => {
        if (flights.get(key) === activeFlight) flights.delete(key);
      });
    flights.set(key, activeFlight);
  }
  const current = flight;
  if (
    options.blob &&
    isMetadataBlobCurrent(known, options.blob.blob, options.blob.source)
  )
    current.blob = {
      blob: options.blob.blob,
      source: { ...options.blob.source },
    };
  const subscriber: Subscriber = {
    priority: options.priority ?? "visible",
    budget:
      options.budget ??
      createDriveRequestBudget({
        maxRequests: 6,
        // The bounded media read is bracketed by two descriptor checks.
        maxBytes: 1024 * 1024 + 2 * 16384,
      }),
  };
  if (!current.budgets.has(subscriber.budget)) {
    // Joining an active extraction adopts its already spent/reserved allowance;
    // completion settles the same reservation even if this subscriber detaches.
    if (current.budget) {
      subscriber.budget.requestsUsed += current.budget.requestsUsed;
      subscriber.budget.bytesRead += current.budget.bytesRead;
      subscriber.budget.bytesReserved += current.budget.bytesReserved;
    }
    current.budgets.add(subscriber.budget);
  }
  current.subscribers.add(subscriber);
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      current.subscribers.delete(subscriber);
      if (!current.subscribers.size) current.controller.abort();
    };
    const abort = () => {
      finish();
      reject(
        options.signal?.reason ?? new DOMException("Cancelled", "AbortError"),
      );
    };
    const timeout = () => {
      finish();
      resolve({
        metadata: {
          status: "deferred",
          freshness: "unknown",
          error: { code: "timeout", retryable: true },
        },
        loadedNow: false,
      });
    };
    const timer = setTimeout(
      timeout,
      Math.max(0, (options.deadline ?? Date.now() + 15000) - Date.now()),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    void current.promise.then(
      (value) => {
        finish();
        resolve(
          assertKnownTrack(known)
            ? value
            : {
                metadata: { status: "unavailable", freshness: "unknown" },
                loadedNow: false,
              },
        );
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  });
}

export function ensureTrackMetadataFromBlob(
  known: KnownTrack,
  blob: Blob,
  source: MetadataBlobSource,
  options: {
    signal?: AbortSignal;
    priority?: DriveRequestPriority;
    deadline?: number;
  } = {},
) {
  return ensureTrackMetadata(known, {
    ...options,
    priority: options.priority ?? "playback",
    ...(isMetadataBlobCurrent(known, blob, source)
      ? { blob: { blob, source: { ...source } } }
      : {}),
  });
}

useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.isLoggingOut) {
    for (const flight of flights.values()) flight.controller.abort();
    flights.clear();
    statuses.clear();
    statusScopes.clear();
    retryAt.clear();
    changed();
  }
});
