import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const mockFolderCacheClear = vi.fn();
vi.mock("@/stores/folder-cache-store", () => ({
  useFolderCacheStore: Object.assign(() => ({}), {
    getState: () => ({ clear: mockFolderCacheClear }),
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

const mockSetLoggingOut = vi.fn();
const mockLogout = vi.fn().mockResolvedValue(undefined);
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(() => ({}), {
    getState: () => ({
      setLoggingOut: mockSetLoggingOut,
      logout: mockLogout,
    }),
  }),
}));

const mockRemoveAllDownloads = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/offline-download-manager", () => ({
  removeAllDownloads: (...args: unknown[]) => mockRemoveAllDownloads(...args),
}));

describe("clearLocalData", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    postMessageSpy = vi.fn();

    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage: postMessageSpy } },
      writable: true,
      configurable: true,
    });

    // Mock caches API
    Object.defineProperty(globalThis, "caches", {
      value: {
        keys: vi.fn().mockResolvedValue(["drivebeats-shell-v2", "other"]),
        delete: vi.fn().mockResolvedValue(true),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});

describe("logoutAndRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage: vi.fn() } },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(globalThis, "caches", {
      value: {
        keys: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(true),
      },
      writable: true,
      configurable: true,
    });
  });

  it("sets logging out flag and calls auth logout", async () => {
    const { logoutAndRedirect } = await import("@/lib/clear-local-data");

    await logoutAndRedirect();

    expect(mockSetLoggingOut).toHaveBeenCalledWith(true);
    expect(mockLogout).toHaveBeenCalled();
  });
});
