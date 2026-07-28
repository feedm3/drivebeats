import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListGoogleDriveFiles = vi.fn();
vi.mock("@/lib/google-api", () => ({
  listGoogleDriveFiles: (...args: unknown[]) =>
    mockListGoogleDriveFiles(...args),
}));

vi.mock("@/lib/audio", () => ({
  getSupportedAudioQuery: (id: string) => `'${id}' in parents`,
}));

const mockGetValidAccessToken = vi.fn().mockResolvedValue("test-token");
const mockLogout = vi.fn();
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(() => ({}), {
    getState: () => ({
      getValidAccessToken: mockGetValidAccessToken,
      logout: mockLogout,
      isLoggingOut: false,
    }),
  }),
}));

const mockSetFiles = vi.fn();
const mockGetFiles = vi.fn().mockReturnValue(null);
const mockIsStale = vi.fn().mockReturnValue(false);
// Hydration resolves on a later microtask, like a real IndexedDB read.
let hydrationDone = false;
const mockHydrate = vi.fn(async () => {
  await Promise.resolve();
  hydrationDone = true;
});
vi.mock("@/stores/folder-cache-store", () => ({
  useFolderCacheStore: Object.assign(() => ({}), {
    getState: () => ({
      hydrate: mockHydrate,
      setFiles: mockSetFiles,
      getFiles: mockGetFiles,
      isStale: mockIsStale,
    }),
  }),
}));

vi.mock("@/stores/imported-drive-store", () => ({
  getImportedLibraryRootEntries: () => [],
  useImportedDriveStore: Object.assign(() => ({}), {
    getState: () => ({ rootFolders: [], rootFiles: [] }),
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function makeResponse(files: unknown[], nextPageToken?: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ files, nextPageToken }),
  };
}

describe("useFolderContents pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidAccessToken.mockResolvedValue("test-token");
  });

  it("fetches all pages when nextPageToken is present", async () => {
    const page1Files = [{ id: "1", name: "file1.mp3", mimeType: "audio/mpeg" }];
    const page2Files = [{ id: "2", name: "file2.mp3", mimeType: "audio/mpeg" }];

    mockListGoogleDriveFiles
      .mockResolvedValueOnce(makeResponse(page1Files, "token-page-2"))
      .mockResolvedValueOnce(makeResponse(page2Files));

    // Since useFolderContents is a hook, we need to test the callback directly
    // by importing and calling the internal logic. We'll use renderHook pattern.
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("@/hooks/use-folder-contents");

    const { result } = renderHook(() => useFolderContents());
    const files = await result.current.fetchFromApi("folder-abc");

    expect(mockListGoogleDriveFiles).toHaveBeenCalledTimes(2);
    expect(files).toHaveLength(2);
    expect(files?.[0].id).toBe("1");
    expect(files?.[1].id).toBe("2");

    // Verify second call included pageToken
    const secondCallParams = mockListGoogleDriveFiles.mock.calls[1][1];
    expect(secondCallParams.get("pageToken")).toBe("token-page-2");
  });

  it("fetches single page when no nextPageToken", async () => {
    const files = [{ id: "1", name: "file1.mp3", mimeType: "audio/mpeg" }];
    mockListGoogleDriveFiles.mockResolvedValueOnce(makeResponse(files));

    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("@/hooks/use-folder-contents");

    const { result } = renderHook(() => useFolderContents());
    const result2 = await result.current.fetchFromApi("folder-xyz");

    expect(mockListGoogleDriveFiles).toHaveBeenCalledTimes(1);
    expect(result2).toHaveLength(1);
  });

  it("requests nextPageToken in fields parameter", async () => {
    mockListGoogleDriveFiles.mockResolvedValueOnce(makeResponse([]));

    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("@/hooks/use-folder-contents");

    const { result } = renderHook(() => useFolderContents());
    await result.current.fetchFromApi("folder-check");

    const params = mockListGoogleDriveFiles.mock.calls[0][1];
    expect(params.get("fields")).toContain("nextPageToken");
  });
});

describe("useFolderContents cache hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydrationDone = false;
    mockGetValidAccessToken.mockResolvedValue("test-token");
    mockIsStale.mockReturnValue(false);
    // The persisted listing only becomes visible once hydration finished.
    mockGetFiles.mockImplementation(() =>
      hydrationDone
        ? {
            files: [
              { id: "cached", name: "cached.mp3", mimeType: "audio/mpeg" },
            ],
            fetchedAt: Date.now(),
            lastAccessedAt: Date.now(),
          }
        : null,
    );
  });

  it("waits for hydration before deciding a folder is uncached", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("@/hooks/use-folder-contents");

    const { result } = renderHook(() => useFolderContents());

    const onFiles = vi.fn();
    const onLoadingChange = vi.fn();
    await result.current.fetchFolderContents("folder-abc", {
      onFiles,
      onLoadingChange,
      canCommit: () => true,
    });

    expect(mockHydrate).toHaveBeenCalled();
    // Served straight from the persisted cache: no skeleton, no Drive request.
    expect(onFiles).toHaveBeenCalledWith([
      { id: "cached", name: "cached.mp3", mimeType: "audio/mpeg" },
    ]);
    expect(onLoadingChange).toHaveBeenCalledWith(false);
    expect(onLoadingChange).not.toHaveBeenCalledWith(true);
    expect(mockListGoogleDriveFiles).not.toHaveBeenCalled();
  });

  it("revalidates in the background when the hydrated entry is stale", async () => {
    mockIsStale.mockReturnValue(true);
    mockListGoogleDriveFiles.mockResolvedValueOnce(
      makeResponse([
        { id: "fresh", name: "fresh.mp3", mimeType: "audio/mpeg" },
      ]),
    );

    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("@/hooks/use-folder-contents");

    const { result } = renderHook(() => useFolderContents());

    const onFiles = vi.fn();
    const onLoadingChange = vi.fn();
    await result.current.fetchFolderContents("folder-abc", {
      onFiles,
      onLoadingChange,
      canCommit: () => true,
    });

    expect(onLoadingChange).not.toHaveBeenCalledWith(true);
    expect(onFiles).toHaveBeenNthCalledWith(1, [
      { id: "cached", name: "cached.mp3", mimeType: "audio/mpeg" },
    ]);
    expect(onFiles).toHaveBeenNthCalledWith(2, [
      { id: "fresh", name: "fresh.mp3", mimeType: "audio/mpeg" },
    ]);
  });
});
