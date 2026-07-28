import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FolderListingInput,
  FolderListingRecord,
} from "@/lib/folder-cache-db";
import type { DriveFile } from "@/types";

// Mock all store modules before importing the module under test
vi.mock("sonner", () => ({ toast: { dismiss: vi.fn() } }));

const mockResetPlayback = vi.fn();
const mockClearCache = vi.fn();
const mockPlayerSetState = vi.fn();
const mockPlayerClearStorage = vi.fn();
vi.mock("@/stores/player-store", () => ({
  usePlayerStore: Object.assign(() => ({}), {
    getState: () => ({
      resetPlayback: mockResetPlayback,
      clearCache: mockClearCache,
    }),
    setState: mockPlayerSetState,
    persist: { clearStorage: mockPlayerClearStorage },
  }),
}));

const mockLibraryClearAll = vi.fn();
const mockLibraryClearStorage = vi.fn();
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: Object.assign(() => ({}), {
    getState: () => ({ clearAll: mockLibraryClearAll }),
    persist: { clearStorage: mockLibraryClearStorage },
  }),
}));

const mockPlaylistClearCloud = vi.fn();
const mockPlaylistClearStorage = vi.fn();
vi.mock("@/stores/playlist-store", () => ({
  usePlaylistStore: Object.assign(() => ({}), {
    getState: () => ({ clearCloudState: mockPlaylistClearCloud }),
    persist: { clearStorage: mockPlaylistClearStorage },
  }),
}));

const mockMetadataClearAll = vi.fn();
const mockMetadataClearStorage = vi.fn();
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: Object.assign(() => ({}), {
    getState: () => ({ clearAll: mockMetadataClearAll }),
    persist: { clearStorage: mockMetadataClearStorage },
  }),
}));

const mockImportedDriveClear = vi.fn();
const mockImportedDriveClearStorage = vi.fn();
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: Object.assign(() => ({}), {
    getState: () => ({ clear: mockImportedDriveClear }),
    persist: { clearStorage: mockImportedDriveClearStorage },
  }),
}));

// ---------------------------------------------------------------------------
// The folder cache and the auth store run for real here.
//
// The privacy defect this file guards lives precisely in the seam between them:
// `clearLocalData()` wipes the folder listing cache, and only afterwards does
// `logout()` clear the auth user. Faking either side would fake away the bug,
// so only the IndexedDB layer underneath is stubbed. The spies below wrap the
// real actions instead of replacing them.
// ---------------------------------------------------------------------------
const persistedListings = new Map<string, FolderListingRecord>();

function listingKey(userId: string, folderId: string) {
  return `${userId}\u0000${folderId}`;
}

const mockClearFolderListings = vi.fn();
vi.mock("@/lib/folder-cache-db", () => ({
  loadFolderListingsForUser: async (userId: string) =>
    [...persistedListings.values()]
      .filter((record) => record.userId === userId)
      .map((record) => ({ ...record })),
  putFolderListing: async (record: FolderListingInput) => {
    const key = listingKey(record.userId, record.folderId);
    persistedListings.set(key, { ...record, key });
  },
  deleteFolderListings: async (userId: string, folderIds: string[]) => {
    for (const folderId of folderIds) {
      persistedListings.delete(listingKey(userId, folderId));
    }
  },
  clearFolderListingsForUser: async (userId: string) => {
    for (const [key, record] of persistedListings) {
      if (record.userId === userId) persistedListings.delete(key);
    }
  },
  clearFolderListingsForOtherUsers: async (userId: string) => {
    for (const [key, record] of persistedListings) {
      if (record.userId !== userId) persistedListings.delete(key);
    }
  },
  clearFolderListings: async () => {
    await mockClearFolderListings();
    persistedListings.clear();
  },
}));

// Registered with `vi.doMock` from `resetEnvironment()` rather than the hoisted
// `vi.mock`, because `vi.resetModules()` does not re-run a cached mock factory.
// These two modules keep module-level state that a logout is *supposed* to make
// permanent — the folder cache seals itself, the auth store memoises its logout
// promise — so every test needs genuinely fresh instances.
const mockFolderCacheClear = vi.fn();

async function mockFolderCacheStore(
  importOriginal: <T>() => Promise<T>,
): Promise<typeof import("@/stores/folder-cache-store")> {
  const actual =
    await importOriginal<typeof import("@/stores/folder-cache-store")>();
  const realClear = actual.useFolderCacheStore.getState().clear;
  actual.useFolderCacheStore.setState({
    clear: () => {
      mockFolderCacheClear();
      realClear();
    },
  });
  return actual;
}

const mockSetLoggingOut = vi.fn();
const mockLogout = vi.fn();

async function mockAuthStore(
  importOriginal: <T>() => Promise<T>,
): Promise<typeof import("@/stores/auth-store")> {
  const actual = await importOriginal<typeof import("@/stores/auth-store")>();
  const { setLoggingOut, logout } = actual.useAuthStore.getState();
  actual.useAuthStore.setState({
    setLoggingOut: (value: boolean) => {
      mockSetLoggingOut(value);
      setLoggingOut(value);
    },
    logout: async () => {
      mockLogout();
      await logout();
    },
  });
  return actual;
}

const mockRemoveAllDownloads = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/offline-download-manager", () => ({
  removeAllDownloads: (...args: unknown[]) => mockRemoveAllDownloads(...args),
}));

const USER_ID = "111111111111111111111";
const ACTIVE_USER_STORAGE_KEY = "drivebeats-folder-cache-user";

function makeFile(id: string): DriveFile {
  return { id, name: `${id}.mp3`, mimeType: "audio/mpeg" } as DriveFile;
}

/** Lets the best-effort background persistence promises settle. */
function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Every test starts from a fresh module registry: the folder cache seals itself
 * for the lifetime of the page once it is wiped, which is exactly the point, so
 * one logout must not leak into the next test.
 */
function resetEnvironment() {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doMock("@/stores/folder-cache-store", mockFolderCacheStore);
  vi.doMock("@/stores/auth-store", mockAuthStore);
  persistedListings.clear();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

  Object.defineProperty(globalThis, "caches", {
    value: {
      keys: vi.fn().mockResolvedValue(["drivebeats-shell-v2", "other"]),
      delete: vi.fn().mockResolvedValue(true),
    },
    writable: true,
    configurable: true,
  });
}

/** Signs `USER_ID` in before the folder cache module first evaluates. */
async function loadSignedInModules() {
  const { useAuthStore } = await import("@/stores/auth-store");
  useAuthStore.setState({
    user: { id: USER_ID, email: "a@example.com", name: null, picture: null },
    authStatus: "authenticated",
    isLoggingOut: false,
  });

  const { useFolderCacheStore } = await import("@/stores/folder-cache-store");
  await useFolderCacheStore.getState().hydrate();

  return { useAuthStore, useFolderCacheStore };
}

describe("clearLocalData", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetEnvironment();
    postMessageSpy = vi.fn();

    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage: postMessageSpy } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears all stores and local storage", async () => {
    const { clearLocalData } = await import("@/lib/clear-local-data");

    await clearLocalData();

    expect(mockResetPlayback).toHaveBeenCalled();
    expect(mockClearCache).toHaveBeenCalled();
    expect(mockPlayerClearStorage).toHaveBeenCalled();
    expect(mockLibraryClearAll).toHaveBeenCalled();
    expect(mockLibraryClearStorage).toHaveBeenCalled();
    expect(mockPlaylistClearCloud).toHaveBeenCalled();
    expect(mockPlaylistClearStorage).toHaveBeenCalled();
    expect(mockMetadataClearAll).toHaveBeenCalled();
    expect(mockMetadataClearStorage).toHaveBeenCalled();
    expect(mockFolderCacheClear).toHaveBeenCalled();
    expect(mockClearFolderListings).toHaveBeenCalled();
    expect(mockImportedDriveClear).toHaveBeenCalled();
    expect(mockImportedDriveClearStorage).toHaveBeenCalled();
    expect(mockRemoveAllDownloads).toHaveBeenCalled();
  });

  it("posts CLEAR_CACHES message to service worker", async () => {
    const { clearLocalData } = await import("@/lib/clear-local-data");

    await clearLocalData();

    expect(postMessageSpy).toHaveBeenCalledWith("CLEAR_CACHES");
  });

  it("deletes all cache storage entries as fallback", async () => {
    const { clearLocalData } = await import("@/lib/clear-local-data");

    await clearLocalData();

    expect(caches.keys).toHaveBeenCalled();
    expect(caches.delete).toHaveBeenCalledWith("drivebeats-shell-v2");
    expect(caches.delete).toHaveBeenCalledWith("other");
  });

  it("continues even if removeAllDownloads fails", async () => {
    mockRemoveAllDownloads.mockRejectedValueOnce(new Error("IDB error"));

    const { clearLocalData } = await import("@/lib/clear-local-data");
    await expect(clearLocalData()).resolves.not.toThrow();

    expect(mockFolderCacheClear).toHaveBeenCalled();
  });

  it("wipes the persisted folder listing cache after clearing memory", async () => {
    const { useFolderCacheStore } = await loadSignedInModules();
    useFolderCacheStore.getState().setFiles("folder-a", [makeFile("1")]);
    await flush();
    expect(persistedListings.size).toBe(1);

    const { clearLocalData } = await import("@/lib/clear-local-data");
    await clearLocalData();

    expect(mockFolderCacheClear).toHaveBeenCalled();
    expect(mockClearFolderListings).toHaveBeenCalled();
    expect(persistedListings.size).toBe(0);
    expect(useFolderCacheStore.getState().cache.size).toBe(0);
    expect(window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY)).toBeNull();
  });

  it("continues even if wiping the folder listing cache fails", async () => {
    // Once for the background wipe `clear()` fires, once for the awaited wipe
    // `clearLocalData()` runs to be sure it finished before the redirect.
    mockClearFolderListings
      .mockRejectedValueOnce(new Error("IDB error"))
      .mockRejectedValueOnce(new Error("IDB error"));

    const { clearLocalData } = await import("@/lib/clear-local-data");

    await expect(clearLocalData()).resolves.not.toThrow();
  });
});

describe("logoutAndRedirect", () => {
  beforeEach(() => {
    resetEnvironment();

    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage: vi.fn() } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets logging out flag and calls auth logout", async () => {
    const { logoutAndRedirect } = await import("@/lib/clear-local-data");

    await logoutAndRedirect();

    expect(mockSetLoggingOut).toHaveBeenCalledWith(true);
    expect(mockLogout).toHaveBeenCalled();
  });

  it("raises the logging-out flag before anything is wiped", async () => {
    const { useAuthStore } = await loadSignedInModules();
    const { logoutAndRedirect } = await import("@/lib/clear-local-data");

    // The folder cache closes itself to writes on `isLoggingOut`, so the flag
    // has to be up before `clearLocalData()` runs at all. Otherwise a Drive
    // listing response landing mid-wipe is persisted all over again.
    let loggingOutAtWipe: boolean | null = null;
    mockFolderCacheClear.mockImplementationOnce(() => {
      loggingOutAtWipe = useAuthStore.getState().isLoggingOut;
    });

    await logoutAndRedirect();

    expect(loggingOutAtWipe).toBe(true);
    expect(mockSetLoggingOut.mock.invocationCallOrder[0]).toBeLessThan(
      mockFolderCacheClear.mock.invocationCallOrder[0],
    );
    // The auth user is only cleared last, which is why the wipe cannot be the
    // only thing standing between logout and the previous account's data.
    expect(mockFolderCacheClear.mock.invocationCallOrder[0]).toBeLessThan(
      mockLogout.mock.invocationCallOrder[0],
    );
  });

  it("cannot be undone by a Drive listing that lands between the wipe and the redirect", async () => {
    const { useAuthStore, useFolderCacheStore } = await loadSignedInModules();

    useFolderCacheStore.getState().setFiles("folder-a", [makeFile("secret")]);
    await flush();
    expect(persistedListings.size).toBe(1);
    expect(window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY)).toBe(USER_ID);

    // `clearLocalData()` clears the imported-drive store after the folder cache
    // wipe and before `logout()`, so this callback runs in exactly the window
    // the defect lived in: storage is already gone, the auth user is still
    // there, and the page has not navigated yet.
    mockImportedDriveClear.mockImplementationOnce(() => {
      expect(useAuthStore.getState().user?.id).toBe(USER_ID);
      useFolderCacheStore.getState().setFiles("folder-b", [makeFile("leaked")]);
    });

    const { logoutAndRedirect } = await import("@/lib/clear-local-data");
    await logoutAndRedirect();
    await flush();

    expect(mockImportedDriveClear).toHaveBeenCalled();
    // Neither the Drive file names nor the account id that scopes them may
    // survive on a shared device.
    expect(persistedListings.size).toBe(0);
    expect(window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY)).toBeNull();
    // Nor may the listing stay renderable before the redirect completes.
    expect(useFolderCacheStore.getState().cache.size).toBe(0);
  });
});
