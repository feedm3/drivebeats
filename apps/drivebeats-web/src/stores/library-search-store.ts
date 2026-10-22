import { create } from "zustand";
import {
  GoogleDriveReadError,
  LibraryIncompleteError,
} from "@/lib/drive-read-error";
import {
  createDriveRequestBudget,
  DriveDeferredError,
  DrivePreemptedError,
} from "@/lib/drive-request-scheduler";
import {
  clearLibrarySearchCatalogForUser,
  clearLibrarySearchCatalogs,
  clearLibrarySearchCatalogsForOtherUsers,
  estimateLibrarySearchCatalogBytes,
  type LibrarySearchCatalogRecord,
  loadLibrarySearchCatalog,
  replaceLibrarySearchCatalog,
} from "@/lib/library-search-catalog-db";
import { buildLibrarySearchCatalogFromDrive } from "@/lib/library-search-drive";
import {
  createLibrarySearchProgress,
  MAX_CATALOG_CHECKPOINT_AGE_MS,
} from "@/lib/library-search-progress";
import { useAuthStore } from "@/stores/auth-store";
import { useImportedDriveStore } from "@/stores/imported-drive-store";

type LibrarySearchStatus = "idle" | "loading" | "ready" | "error";

export interface LibrarySearchFailure {
  code:
    | "network_error"
    | "offline"
    | "drive_auth_required"
    | "drive_access_denied"
    | "drive_rate_limited"
    | "library_incomplete"
    | "library_unavailable";
  message: string;
}

interface LibrarySearchState {
  catalog: LibrarySearchCatalogRecord | null;
  error: string | null;
  failure: LibrarySearchFailure | null;
  hydrated: boolean;
  invalidated: boolean;
  sessionOnly: boolean;
  status: LibrarySearchStatus;
  clear: () => Promise<void>;
  ensureReady: (
    signal?: AbortSignal,
    options?: { background?: boolean },
  ) => Promise<boolean>;
  buildProgress: number;
  hydrate: () => Promise<void>;
  invalidate: () => void;
  isPotentiallyOutdated: () => boolean;
  isStale: () => boolean;
  refresh: () => Promise<boolean>;
  sealAndClear: () => Promise<void>;
}

const ACTIVE_USER_STORAGE_KEY = "drivebeats-library-search-user";
const STALE_MS = 24 * 60 * 60 * 1_000;
export const MAX_DURABLE_LIBRARY_SEARCH_BYTES = 16 * 1024 * 1024;

let activeUserId: string | null = null;
let catalogSealed = false;
let hydrationPromise: Promise<void> | null = null;
let ownershipVersion = 0;
let refreshVersion = 0;
let refreshAbortController: AbortController | null = null;
interface RefreshFlight {
  userId: string;
  importsSignature: string;
  promise: Promise<boolean>;
}
let refreshFlight: RefreshFlight | null = null;
let wakeBuild: (() => void) | null = null;
const foregroundConsumers = new Map<
  string,
  ReturnType<typeof createDriveRequestBudget>
>();
const foregroundCompletion = new Map<string, () => void>();
const remoteConsumerTimers = new Map<string, ReturnType<typeof setTimeout>>();
const catalogTabId = crypto.randomUUID();
let catalogChannel: BroadcastChannel | undefined;
const completedSessionCatalogs = new Map<string, LibrarySearchCatalogRecord>();
interface CatalogCoordinationMessage {
  type:
    | "foreground_start"
    | "foreground_end"
    | "foreground_exhausted"
    | "catalog_complete";
  record?: LibrarySearchCatalogRecord;
  userId: string | null;
  importsSignature: string;
  key: string;
}
function catalogCoordinationChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return undefined;
  if (!catalogChannel) {
    catalogChannel = new BroadcastChannel("drivebeats-library-catalog-v1");
    catalogChannel.onmessage = (
      event: MessageEvent<CatalogCoordinationMessage>,
    ) => {
      const message = event.data;
      if (
        message.userId !== useAuthStore.getState().user?.id ||
        message.importsSignature !== getLibrarySearchImportsSignature()
      )
        return;
      if (message.type === "catalog_complete") {
        if (
          message.record?.userId === message.userId &&
          message.record.importsSignature === message.importsSignature
        )
          completedSessionCatalogs.set(
            message.importsSignature,
            message.record,
          );
        return;
      }
      if (message.type === "foreground_start") {
        if (foregroundConsumers.has(message.key)) return;
        foregroundConsumers.set(
          message.key,
          createDriveRequestBudget({
            maxRequests: 20,
            maxBytes: 16 * 1024 * 1024,
          }),
        );
        remoteConsumerTimers.set(
          message.key,
          setTimeout(() => {
            foregroundConsumers.delete(message.key);
            remoteConsumerTimers.delete(message.key);
            wakeBuild?.();
          }, 15_000),
        );
      } else {
        foregroundConsumers.delete(message.key);
        clearTimeout(remoteConsumerTimers.get(message.key));
        remoteConsumerTimers.delete(message.key);
        if (message.type === "foreground_exhausted")
          foregroundCompletion.get(message.key)?.();
      }
      if (!foregroundConsumers.size && document.visibilityState === "hidden")
        refreshAbortController?.abort();
      wakeBuild?.();
    };
  }
  return catalogChannel;
}
function announceForeground(
  type: CatalogCoordinationMessage["type"],
  key: string,
) {
  catalogCoordinationChannel()?.postMessage({
    type,
    key,
    userId: useAuthStore.getState().user?.id ?? null,
    importsSignature: getLibrarySearchImportsSignature(),
  } satisfies CatalogCoordinationMessage);
}
function detachExhaustedConsumers() {
  for (const [key, budget] of foregroundConsumers) {
    if (
      budget.requestsUsed < budget.maxRequests &&
      budget.bytesRead < budget.maxBytes
    )
      continue;
    foregroundConsumers.delete(key);
    foregroundCompletion.get(key)?.();
    announceForeground("foreground_exhausted", key);
  }
}
async function foreground(work: () => Promise<boolean>): Promise<boolean> {
  const key = `${catalogTabId}:${crypto.randomUUID()}`;
  foregroundConsumers.set(
    key,
    createDriveRequestBudget({ maxRequests: 20, maxBytes: 16 * 1024 * 1024 }),
  );
  let detach!: () => void;
  const detached = new Promise<false>((resolve) => {
    detach = () => resolve(false);
  });
  foregroundCompletion.set(key, detach);
  const timeout = setTimeout(detach, 15_000);
  announceForeground("foreground_start", key);
  wakeBuild?.();
  try {
    return await Promise.race([work(), detached]);
  } finally {
    clearTimeout(timeout);
    foregroundConsumers.delete(key);
    foregroundCompletion.delete(key);
    if (!foregroundConsumers.size && document.visibilityState === "hidden")
      refreshAbortController?.abort();
    announceForeground("foreground_end", key);
    wakeBuild?.();
  }
}
function waitForBuild(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (wakeBuild === finish) wakeBuild = null;
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("Catalog build cancelled", "AbortError"));
    };
    const timer = setTimeout(finish, Math.max(50, ms));
    wakeBuild = finish;
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
let catalogWrites: Promise<unknown> = Promise.resolve();

function queueCatalogWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = catalogWrites.then(write);
  catalogWrites = result.catch(() => undefined);
  return result;
}

function readRememberedUserId() {
  try {
    return window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberUserId(userId: string | null) {
  try {
    if (userId) {
      window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, userId);
    } else {
      window.localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
    }
  } catch {
    // Persistence is optional.
  }
}

let importsSignatureCache: {
  rootFolders: unknown;
  rootFiles: unknown;
  signature: string;
} | null = null;
export function getLibrarySearchImportsSignature() {
  const { rootFolders, rootFiles } = useImportedDriveStore.getState();
  if (
    importsSignatureCache?.rootFolders === rootFolders &&
    importsSignatureCache.rootFiles === rootFiles
  )
    return importsSignatureCache.signature;
  const signature = [
    ...rootFolders.map((folder) => `folder:${folder.id}`),
    ...rootFiles.map((track) => `track:${track.id}`),
  ]
    .toSorted()
    .join("|");
  importsSignatureCache = { rootFolders, rootFiles, signature };
  return signature;
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}

function refreshFailure(error: unknown): LibrarySearchFailure | null {
  if (error instanceof Error && error.name === "AbortError") {
    return null;
  }
  if (!isOnline()) {
    return {
      code: "offline",
      message: "Search requires an internet connection.",
    };
  }
  if (error instanceof GoogleDriveReadError) {
    if (error.status === 401)
      return {
        code: "drive_auth_required",
        message: "Your Google Drive session expired. Please sign in again.",
      };
    if (error.status === 403)
      return {
        code: "drive_access_denied",
        message:
          "DriveBeats cannot read part of this Library. Check Google Drive access.",
      };
    if (error.status === 429)
      return {
        code: "drive_rate_limited",
        message: "Google Drive is busy. Wait a moment, then try again.",
      };
  }
  if (error instanceof LibraryIncompleteError) {
    return {
      code: "library_incomplete",
      message: "Google Drive could not check the complete Library. Try again.",
    };
  }
  if (error instanceof TypeError)
    return {
      code: "network_error",
      message:
        "Could not connect to Google Drive. Check your connection and try again.",
    };
  return {
    code: "library_unavailable",
    message:
      "Could not refresh the Library. Check your connection and try again.",
  };
}

function waitForCaller<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(
      new DOMException("Library Search request was cancelled", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(
        new DOMException("Library Search request was cancelled", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function detachAllForegroundConsumers() {
  completedSessionCatalogs.clear();
  for (const finish of foregroundCompletion.values()) finish();
  foregroundConsumers.clear();
  for (const timer of remoteConsumerTimers.values()) clearTimeout(timer);
  remoteConsumerTimers.clear();
}

function adoptUser(userId: string) {
  detachAllForegroundConsumers();
  activeUserId = userId;
  ownershipVersion += 1;
  refreshVersion += 1;
  refreshAbortController?.abort();
  refreshAbortController = null;
  refreshFlight = null;
  hydrationPromise = null;
  rememberUserId(userId);
  useLibrarySearchStore.setState({
    catalog: null,
    error: null,
    failure: null,
    hydrated: false,
    invalidated: false,
    sessionOnly: false,
    status: "idle",
  });
  void queueCatalogWrite(() => clearLibrarySearchCatalogsForOtherUsers(userId));
}

function syncActiveUser() {
  if (catalogSealed) return;
  const liveUserId = useAuthStore.getState().user?.id ?? null;
  if (!liveUserId || liveUserId === activeUserId) return;
  adoptUser(liveUserId);
}

async function hydrateCurrentUser() {
  for (;;) {
    syncActiveUser();
    const userId = activeUserId;
    const version = ownershipVersion;

    if (!userId) {
      useLibrarySearchStore.setState({ hydrated: true });
      return;
    }

    const record = await loadLibrarySearchCatalog(userId);
    if (catalogSealed) return;
    if (version !== ownershipVersion || userId !== activeUserId) continue;

    const currentSignature = getLibrarySearchImportsSignature();
    useLibrarySearchStore.setState({
      catalog: record,
      hydrated: true,
      invalidated: Boolean(
        record && record.importsSignature !== currentSignature,
      ),
      sessionOnly: false,
      status: record ? "ready" : "idle",
    });
    return;
  }
}

async function wipeCatalog(seal: boolean) {
  detachAllForegroundConsumers();
  if (seal) {
    catalogSealed = true;
    activeUserId = null;
    rememberUserId(null);
  }
  ownershipVersion += 1;
  refreshVersion += 1;
  refreshAbortController?.abort();
  refreshAbortController = null;
  refreshFlight = null;
  hydrationPromise = null;
  useLibrarySearchStore.setState({
    catalog: null,
    error: null,
    failure: null,
    hydrated: true,
    invalidated: false,
    sessionOnly: false,
    status: "idle",
  });
  await queueCatalogWrite(clearLibrarySearchCatalogs);
}

export const useLibrarySearchStore = create<LibrarySearchState>((set, get) => ({
  catalog: null,
  buildProgress: 0,
  error: null,
  failure: null,
  hydrated: false,
  invalidated: false,
  sessionOnly: false,
  status: "idle",

  hydrate: () => {
    if (!hydrationPromise) {
      hydrationPromise = hydrateCurrentUser();
    }
    return hydrationPromise;
  },

  isStale: () => {
    const { catalog, invalidated } = get();
    return invalidated || !catalog || Date.now() - catalog.fetchedAt > STALE_MS;
  },

  isPotentiallyOutdated: () => {
    return (
      Boolean(get().catalog) && (get().status === "error" || get().isStale())
    );
  },

  ensureReady: async (signal, options) => {
    if (signal?.aborted)
      throw new DOMException(
        "Library Search request was cancelled",
        "AbortError",
      );
    const work = () =>
      waitForCaller(
        (async () => {
          await get().hydrate();
          if (signal?.aborted) return false;
          if (catalogSealed) return false;
          if (!isOnline()) {
            if (get().isStale() && get().status !== "loading") {
              const failure = refreshFailure(new Error("Offline"));
              set({
                failure,
                error: failure?.message ?? null,
                status: "error",
              });
            }
            return false;
          }
          if (get().isStale()) {
            const pending = startRefresh(false);
            if (options?.background && signal) {
              const cancelBackground = () => {
                if (foregroundConsumers.size === 0)
                  refreshAbortController?.abort();
              };
              signal.addEventListener("abort", cancelBackground, {
                once: true,
              });
              try {
                return await pending;
              } finally {
                signal.removeEventListener("abort", cancelBackground);
              }
            }
            return pending;
          }
          return Boolean(get().catalog);
        })(),
        signal,
      );
    return options?.background ? work() : foreground(work);
  },

  refresh: () => foreground(() => startRefresh(true)),

  invalidate: () => set({ invalidated: true }),
  clear: () => wipeCatalog(false),
  sealAndClear: () => wipeCatalog(true),
}));

function startRefresh(supersede: boolean): Promise<boolean> {
  syncActiveUser();
  const userId = activeUserId;
  if (catalogSealed || !userId) return Promise.resolve(false);
  const importsSignature = getLibrarySearchImportsSignature();
  if (
    !supersede &&
    refreshFlight?.userId === userId &&
    refreshFlight.importsSignature === importsSignature
  )
    return refreshFlight.promise;
  if (!isOnline()) {
    const failure = refreshFailure(new Error("Offline"));
    useLibrarySearchStore.setState({
      failure,
      error: failure?.message ?? null,
      status: "error",
    });
    return Promise.resolve(false);
  }

  const requestVersion = refreshVersion + 1;
  refreshVersion = requestVersion;
  const requestOwnershipVersion = ownershipVersion;
  refreshAbortController?.abort();
  const controller = new AbortController();
  refreshAbortController = controller;
  useLibrarySearchStore.setState({
    error: null,
    failure: null,
    status: "loading",
    buildProgress: 0,
  });
  const flight: RefreshFlight = {
    userId,
    importsSignature,
    promise: Promise.resolve(false),
  };
  refreshFlight = flight;
  const build = async () => {
    try {
      const accessToken = await useAuthStore.getState().getValidAccessToken();
      if (
        controller.signal.aborted ||
        catalogSealed ||
        requestVersion !== refreshVersion ||
        userId !== useAuthStore.getState().user?.id
      )
        return false;
      if (!accessToken) {
        if (useAuthStore.getState().authStatus === "unauthenticated")
          throw new GoogleDriveReadError(401);
        throw new TypeError("Google Drive authentication could not be reached");
      }

      const { rootFolders, rootFiles } = useImportedDriveStore.getState();
      if (importsSignature !== getLibrarySearchImportsSignature())
        return startRefresh(false);
      const progressKey = `catalog:${userId}:${importsSignature}`;
      const progress = createLibrarySearchProgress(progressKey, {
        signal: controller.signal,
        isCurrent: () =>
          userId === activeUserId &&
          importsSignature === getLibrarySearchImportsSignature() &&
          requestVersion === refreshVersion &&
          requestOwnershipVersion === ownershipVersion,
      });
      let checkpoint = await progress.load();
      let buildStartedAt = checkpoint?.startedAt ?? Date.now();
      let restartedInvalidToken = false;
      let tracks: LibrarySearchCatalogRecord["tracks"];
      for (;;) {
        controller.signal.throwIfAborted();
        detachExhaustedConsumers();
        if (Date.now() - buildStartedAt > MAX_CATALOG_CHECKPOINT_AGE_MS) {
          await progress.clear();
          checkpoint = undefined;
          buildStartedAt = Date.now();
        }
        try {
          tracks =
            rootFolders.length === 0 && rootFiles.length === 0
              ? []
              : await buildLibrarySearchCatalogFromDrive({
                  accessToken,
                  importedFolders: rootFolders,
                  standaloneTracks: rootFiles,
                  signal: controller.signal,
                  checkpoint,
                  startedAt: buildStartedAt,
                  requestOptions: {
                    accountId: userId,
                    priority: () =>
                      foregroundConsumers.size ? "navigation" : "background",
                    get budget() {
                      return foregroundConsumers.values().next().value;
                    },
                  },
                  onCheckpoint: async (next, page) => {
                    checkpoint = next;
                    useLibrarySearchStore.setState({
                      buildProgress:
                        next.audioFiles.length + next.folders.length,
                    });
                    if (
                      !controller.signal.aborted &&
                      userId === activeUserId &&
                      importsSignature === getLibrarySearchImportsSignature()
                    ) {
                      const persisted = await progress.save(next, page);
                      if (!persisted && !controller.signal.aborted)
                        useLibrarySearchStore.setState({ sessionOnly: true });
                    }
                  },
                });
          break;
        } catch (error) {
          if (
            !(
              error instanceof DriveDeferredError ||
              error instanceof DrivePreemptedError
            )
          ) {
            if (!controller.signal.aborted) {
              const invalidToken =
                error instanceof GoogleDriveReadError &&
                error.status === 400 &&
                Boolean(checkpoint?.pageToken);
              await progress.clear();
              if (invalidToken && !restartedInvalidToken) {
                restartedInvalidToken = true;
                checkpoint = undefined;
                buildStartedAt = Date.now();
                continue;
              }
            }
            throw error;
          }
          detachExhaustedConsumers();
          if (
            error instanceof DriveDeferredError &&
            error.reason === "coordination_unavailable" &&
            !foregroundConsumers.size
          )
            throw error;
          await waitForBuild(
            error instanceof DriveDeferredError
              ? Math.max(100, error.retryAfterMs)
              : 250,
            controller.signal,
          );
        }
      }

      if (
        catalogSealed ||
        controller.signal.aborted ||
        requestVersion !== refreshVersion ||
        requestOwnershipVersion !== ownershipVersion ||
        userId !== activeUserId ||
        userId !== useAuthStore.getState().user?.id
      ) {
        return false;
      }

      if (importsSignature !== getLibrarySearchImportsSignature()) {
        return startRefresh(false);
      }

      const record: LibrarySearchCatalogRecord = {
        fetchedAt: buildStartedAt,
        completedAt: Date.now(),
        importsSignature,
        tracks,
        userId,
      };
      const withinDurableLimit =
        estimateLibrarySearchCatalogBytes(record) <=
        MAX_DURABLE_LIBRARY_SEARCH_BYTES;
      const persisted = withinDurableLimit
        ? await queueCatalogWrite(() => replaceLibrarySearchCatalog(record))
        : false;

      if (!persisted) {
        await queueCatalogWrite(() => clearLibrarySearchCatalogForUser(userId));
      }

      if (
        catalogSealed ||
        controller.signal.aborted ||
        requestVersion !== refreshVersion ||
        requestOwnershipVersion !== ownershipVersion ||
        userId !== useAuthStore.getState().user?.id
      ) {
        return false;
      }

      if (importsSignature !== getLibrarySearchImportsSignature())
        return startRefresh(false);
      await progress.clear();
      if (
        catalogSealed ||
        controller.signal.aborted ||
        requestVersion !== refreshVersion ||
        requestOwnershipVersion !== ownershipVersion ||
        userId !== activeUserId ||
        importsSignature !== getLibrarySearchImportsSignature()
      )
        return false;
      if (!persisted) {
        completedSessionCatalogs.set(importsSignature, record);
        catalogCoordinationChannel()?.postMessage({
          type: "catalog_complete",
          key: catalogTabId,
          userId,
          importsSignature,
          record,
        } satisfies CatalogCoordinationMessage);
      }
      useLibrarySearchStore.setState({
        catalog: record,
        error: null,
        failure: null,
        hydrated: true,
        invalidated: false,
        sessionOnly: !persisted,
        status: "ready",
      });
      return true;
    } catch (error) {
      const failure = refreshFailure(error);
      if (
        failure &&
        !catalogSealed &&
        !controller.signal.aborted &&
        requestVersion === refreshVersion &&
        requestOwnershipVersion === ownershipVersion &&
        userId === useAuthStore.getState().user?.id
      ) {
        useLibrarySearchStore.setState({
          failure,
          error: failure.message,
          status: "error",
        });
      }
      return false;
    } finally {
      if (refreshAbortController === controller) {
        refreshAbortController = null;
      }
      if (refreshFlight === flight) refreshFlight = null;
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    const requestedAt = Date.now();
    flight.promise = navigator.locks
      .request(
        `drivebeats:catalog:${userId}:${importsSignature}`,
        { signal: controller.signal },
        async () => {
          controller.signal.throwIfAborted();
          // A preceding tab may have finished while this consumer waited. Reuse its
          // complete generation instead of starting the same Drive listing again.
          let shared = await loadLibrarySearchCatalog(userId);
          let sharedSessionOnly = false;
          if (!shared) {
            shared = completedSessionCatalogs.get(importsSignature) ?? null;
            sharedSessionOnly = Boolean(shared);
          }
          if (
            shared &&
            shared.importsSignature === importsSignature &&
            (shared.completedAt ?? shared.fetchedAt) >= requestedAt &&
            !catalogSealed &&
            !controller.signal.aborted &&
            requestVersion === refreshVersion &&
            requestOwnershipVersion === ownershipVersion &&
            userId === activeUserId &&
            importsSignature === getLibrarySearchImportsSignature()
          ) {
            useLibrarySearchStore.setState({
              catalog: shared,
              hydrated: true,
              invalidated: false,
              sessionOnly: sharedSessionOnly,
              error: null,
              failure: null,
              status: "ready",
            });
            if (refreshFlight === flight) refreshFlight = null;
            if (refreshAbortController === controller)
              refreshAbortController = null;
            return true;
          }
          return build();
        },
      )
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return false;
        throw error;
      });
  } else flight.promise = build();
  return flight.promise;
}

if (typeof window !== "undefined") {
  catalogCoordinationChannel();
  activeUserId = useAuthStore.getState().user?.id ?? readRememberedUserId();
  if (activeUserId) {
    rememberUserId(activeUserId);
    const userId = activeUserId;
    void queueCatalogWrite(() =>
      clearLibrarySearchCatalogsForOtherUsers(userId),
    );
  }
  useAuthStore.subscribe((state, previous) => {
    if (state.isLoggingOut || (!state.user && previous.user)) {
      detachAllForegroundConsumers();
      refreshAbortController?.abort();
    }
    syncActiveUser();
  });
  let importsSignature = getLibrarySearchImportsSignature();
  useImportedDriveStore.subscribe(() => {
    const nextSignature = getLibrarySearchImportsSignature();
    if (nextSignature === importsSignature) return;
    importsSignature = nextSignature;
    completedSessionCatalogs.clear();
    if (!catalogSealed) {
      useLibrarySearchStore.getState().invalidate();
    }
  });
}
