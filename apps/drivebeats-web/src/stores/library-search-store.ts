import { create } from "zustand";
import {
  GoogleDriveReadError,
  LibraryIncompleteError,
} from "@/lib/drive-read-error";
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
  ensureReady: (signal?: AbortSignal) => Promise<boolean>;
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

export function getLibrarySearchImportsSignature() {
  const { rootFolders, rootFiles } = useImportedDriveStore.getState();
  return [
    ...rootFolders.map((folder) => `folder:${folder.id}`),
    ...rootFiles.map((track) => `track:${track.id}`),
  ]
    .toSorted()
    .join("|");
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

function adoptUser(userId: string) {
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

  ensureReady: async (signal) => {
    if (signal?.aborted)
      throw new DOMException(
        "Library Search request was cancelled",
        "AbortError",
      );
    return waitForCaller(
      (async () => {
        await get().hydrate();
        if (signal?.aborted) return false;
        if (catalogSealed) return false;
        if (!isOnline()) {
          if (get().isStale() && get().status !== "loading") {
            const failure = refreshFailure(new Error("Offline"));
            set({ failure, error: failure?.message ?? null, status: "error" });
          }
          return false;
        }
        if (get().isStale()) return startRefresh(false);
        return Boolean(get().catalog);
      })(),
      signal,
    );
  },

  refresh: () => startRefresh(true),

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
  });
  const flight: RefreshFlight = {
    userId,
    importsSignature,
    promise: Promise.resolve(false),
  };
  refreshFlight = flight;
  flight.promise = (async () => {
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
      const tracks =
        rootFolders.length === 0 && rootFiles.length === 0
          ? []
          : await buildLibrarySearchCatalogFromDrive({
              accessToken,
              importedFolders: rootFolders,
              standaloneTracks: rootFiles,
              signal: controller.signal,
            });

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
        fetchedAt: Date.now(),
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
  })();
  return flight.promise;
}

if (typeof window !== "undefined") {
  activeUserId = useAuthStore.getState().user?.id ?? readRememberedUserId();
  if (activeUserId) {
    rememberUserId(activeUserId);
    const userId = activeUserId;
    void queueCatalogWrite(() =>
      clearLibrarySearchCatalogsForOtherUsers(userId),
    );
  }
  useAuthStore.subscribe(syncActiveUser);
  let importsSignature = getLibrarySearchImportsSignature();
  useImportedDriveStore.subscribe(() => {
    const nextSignature = getLibrarySearchImportsSignature();
    if (nextSignature === importsSignature) return;
    importsSignature = nextSignature;
    if (!catalogSealed) {
      useLibrarySearchStore.getState().invalidate();
    }
  });
}
