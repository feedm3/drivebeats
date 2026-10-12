import { create } from "zustand";
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

interface LibrarySearchState {
  catalog: LibrarySearchCatalogRecord | null;
  error: string | null;
  hydrated: boolean;
  invalidated: boolean;
  sessionOnly: boolean;
  status: LibrarySearchStatus;
  clear: () => Promise<void>;
  ensureReady: () => Promise<boolean>;
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

function refreshErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return null;
  }
  if (!isOnline()) {
    return "Search requires an internet connection.";
  }
  if (error instanceof Error && error.message.includes("(401)")) {
    return "Your Google Drive session expired. Please sign in again.";
  }
  if (error instanceof Error && error.message.includes("(403)")) {
    return "DriveBeats cannot read part of this Library. Check Google Drive access.";
  }
  if (error instanceof Error && error.message.includes("incomplete")) {
    return "Google Drive could not check the complete Library. Try again.";
  }
  return "Could not refresh the Library. Check your connection and try again.";
}

function adoptUser(userId: string) {
  activeUserId = userId;
  ownershipVersion += 1;
  refreshVersion += 1;
  refreshAbortController?.abort();
  refreshAbortController = null;
  hydrationPromise = null;
  rememberUserId(userId);
  useLibrarySearchStore.setState({
    catalog: null,
    error: null,
    hydrated: false,
    invalidated: false,
    sessionOnly: false,
    status: "idle",
  });
  void clearLibrarySearchCatalogsForOtherUsers(userId);
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
  hydrationPromise = null;
  useLibrarySearchStore.setState({
    catalog: null,
    error: null,
    hydrated: true,
    invalidated: false,
    sessionOnly: false,
    status: "idle",
  });
  await clearLibrarySearchCatalogs();
}

export const useLibrarySearchStore = create<LibrarySearchState>((set, get) => ({
  catalog: null,
  error: null,
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

  ensureReady: async () => {
    await get().hydrate();
    if (catalogSealed || !isOnline()) return false;
    if (get().isStale()) {
      return get().refresh();
    }
    return Boolean(get().catalog);
  },

  refresh: async () => {
    syncActiveUser();
    const userId = activeUserId;
    if (catalogSealed || !userId) return false;
    if (!isOnline()) {
      set({
        error: "Search requires an internet connection.",
        status: "error",
      });
      return false;
    }

    const requestVersion = refreshVersion + 1;
    refreshVersion = requestVersion;
    const requestOwnershipVersion = ownershipVersion;
    refreshAbortController?.abort();
    const controller = new AbortController();
    refreshAbortController = controller;
    set({ error: null, status: "loading" });

    try {
      const accessToken = await useAuthStore.getState().getValidAccessToken();
      if (!accessToken) {
        throw new Error(
          useAuthStore.getState().authStatus === "unauthenticated"
            ? "Drive Library Search request failed (401)"
            : "Drive unavailable",
        );
      }

      const { rootFolders, rootFiles } = useImportedDriveStore.getState();
      const importsSignature = getLibrarySearchImportsSignature();
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
        userId !== activeUserId
      ) {
        return false;
      }

      if (importsSignature !== getLibrarySearchImportsSignature()) {
        return get().refresh();
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
        ? await replaceLibrarySearchCatalog(record)
        : false;

      if (!persisted) {
        await clearLibrarySearchCatalogForUser(userId);
      }

      if (
        catalogSealed ||
        controller.signal.aborted ||
        requestVersion !== refreshVersion ||
        requestOwnershipVersion !== ownershipVersion
      ) {
        return false;
      }

      set({
        catalog: record,
        error: null,
        hydrated: true,
        invalidated: false,
        sessionOnly: !persisted,
        status: "ready",
      });
      return true;
    } catch (error) {
      const message = refreshErrorMessage(error);
      if (
        message &&
        !catalogSealed &&
        requestVersion === refreshVersion &&
        requestOwnershipVersion === ownershipVersion
      ) {
        set({ error: message, status: "error" });
      }
      return false;
    } finally {
      if (refreshAbortController === controller) {
        refreshAbortController = null;
      }
    }
  },

  invalidate: () => set({ invalidated: true }),
  clear: () => wipeCatalog(false),
  sealAndClear: () => wipeCatalog(true),
}));

if (typeof window !== "undefined") {
  activeUserId = useAuthStore.getState().user?.id ?? readRememberedUserId();
  if (activeUserId) {
    rememberUserId(activeUserId);
    void clearLibrarySearchCatalogsForOtherUsers(activeUserId);
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
