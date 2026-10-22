import { toast } from "sonner";
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
let activeUserId: string | null = "account-one";
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(() => ({}), {
    getState: () => ({
      getValidAccessToken: mockGetValidAccessToken,
      logout: mockLogout,
      isLoggingOut: false,
      user: activeUserId ? { id: activeUserId } : null,
      authStatus: "authenticated",
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

  it.each(["rate_limited", "busy"])(
    "reports retryable %s deferrals without blaming the network",
    async (reason) => {
      mockListGoogleDriveFiles.mockRejectedValueOnce(
        Object.assign(new Error(reason), {
          name: "DriveDeferredError",
          reason,
          retryAfterMs: 120_000,
        }),
      );
      const { renderHook } = await import("@testing-library/react");
      const { useFolderContents } = await import("@/hooks/use-folder-contents");
      const { result } = renderHook(() => useFolderContents());
      const onFailure = vi.fn();
      expect(
        await result.current.fetchFromApi(`folder-${reason}`, { onFailure }),
      ).toBeNull();
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          code: reason === "rate_limited" ? "drive_rate_limited" : "drive_busy",
          retryable: true,
          retryAfterMs: 120_000,
        }),
      );
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("120 seconds"),
      );
      expect(toast.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Network error"),
      );
    },
  );

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("shared folder reads and request ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeUserId = "account-one";
    mockGetValidAccessToken.mockResolvedValue("test-token");
    mockGetFiles.mockReturnValue(null);
    mockIsStale.mockReturnValue(false);
  });

  it("shares one pending browser request across two hook instances and caches once", async () => {
    const response = deferred<ReturnType<typeof makeResponse>>();
    mockListGoogleDriveFiles.mockReturnValueOnce(response.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const first = renderHook(() => useFolderContents());
    const second = renderHook(() => useFolderContents());
    const firstRead = first.result.current.fetchFromApi("shared-folder");
    const secondRead = second.result.current.fetchFromApi("shared-folder");
    await Promise.resolve();
    expect(mockListGoogleDriveFiles).toHaveBeenCalledTimes(1);
    const files = [{ id: "track", name: "Track.mp3", mimeType: "audio/mpeg" }];
    response.resolve(makeResponse(files));
    expect(await firstRead).toEqual(files);
    expect(await secondRead).toEqual(files);
    expect(mockSetFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared read alive when one consumer navigates away", async () => {
    const response = deferred<ReturnType<typeof makeResponse>>();
    mockListGoogleDriveFiles.mockReturnValueOnce(response.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    const controller = new AbortController();
    const obsolete = result.current.fetchFromApi("shared-folder", {
      signal: controller.signal,
    });
    const active = result.current.fetchFromApi("shared-folder");
    await Promise.resolve();
    const sharedSignal = mockListGoogleDriveFiles.mock.calls[0][2];
    controller.abort();
    expect(sharedSignal.aborted).toBe(false);
    const files = [{ id: "track", name: "Track.mp3", mimeType: "audio/mpeg" }];
    response.resolve(makeResponse(files));
    expect(await obsolete).toBeNull();
    expect(await active).toEqual(files);
    expect(mockListGoogleDriveFiles).toHaveBeenCalledTimes(1);
  });

  it("aborts the browser read when its last active consumer leaves and allows a fresh read", async () => {
    mockListGoogleDriveFiles.mockImplementationOnce(
      (_token, _params, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          ),
        ),
    );
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    const controller = new AbortController();
    const old = result.current.fetchFromApi("cancelled-folder", {
      signal: controller.signal,
    });
    await Promise.resolve();
    const sharedSignal = mockListGoogleDriveFiles.mock.calls[0][2];
    controller.abort();
    expect(sharedSignal.aborted).toBe(true);
    mockListGoogleDriveFiles.mockResolvedValueOnce(makeResponse([]));
    const fresh = result.current.fetchFromApi("cancelled-folder");
    expect(await old).toBeNull();
    expect(await fresh).toEqual([]);
    expect(mockListGoogleDriveFiles).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(["network", "401"])(
    "suppresses obsolete %s errors and session effects after navigation",
    async (failure) => {
      const response = deferred<ReturnType<typeof makeResponse>>();
      mockListGoogleDriveFiles.mockReturnValueOnce(response.promise);
      const { renderHook } = await import("@testing-library/react");
      const { useFolderContents } = await import("./use-folder-contents");
      const { result } = renderHook(() => useFolderContents());
      let current = true;
      const read = result.current.fetchFromApi("old-folder", {
        canCommit: () => current,
      });
      await Promise.resolve();
      current = false;
      if (failure === "network")
        response.reject(new TypeError("Failed to fetch"));
      else response.resolve({ ...makeResponse([]), ok: false, status: 401 });
      expect(await read).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
      expect(mockLogout).not.toHaveBeenCalled();
      expect(mockSetFiles).not.toHaveBeenCalled();
    },
  );

  it("does not cache or return one account's delayed listing after another account becomes active", async () => {
    const response = deferred<ReturnType<typeof makeResponse>>();
    mockListGoogleDriveFiles.mockReturnValueOnce(response.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    const old = result.current.fetchFromApi("shared-folder");
    await Promise.resolve();
    activeUserId = "account-two";
    mockListGoogleDriveFiles.mockResolvedValueOnce(
      makeResponse([{ id: "second-account", name: "New.mp3" }]),
    );
    const fresh = result.current.fetchFromApi("shared-folder");
    response.resolve(
      makeResponse([{ id: "private-first-account", name: "Old.mp3" }]),
    );
    expect(await old).toBeNull();
    expect(await fresh).toEqual([{ id: "second-account", name: "New.mp3" }]);
    expect(mockSetFiles).toHaveBeenCalledExactlyOnceWith("shared-folder", [
      { id: "second-account", name: "New.mp3" },
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not start a Google read if the account changes while acquiring its token", async () => {
    const token = deferred<string>();
    mockGetValidAccessToken.mockReturnValueOnce(token.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    const old = result.current.fetchFromApi("old-account-folder");
    activeUserId = "account-two";
    token.resolve("old-account-token");
    expect(await old).toBeNull();
    expect(mockListGoogleDriveFiles).not.toHaveBeenCalled();
    expect(mockSetFiles).not.toHaveBeenCalled();
  });

  it("does not log out a new account when an old account's read returns 401", async () => {
    const response = deferred<ReturnType<typeof makeResponse>>();
    mockListGoogleDriveFiles.mockReturnValueOnce(response.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    const old = result.current.fetchFromApi("old-account-folder");
    await Promise.resolve();
    activeUserId = "account-two";
    response.resolve({ ...makeResponse([]), ok: false, status: 401 });
    expect(await old).toBeNull();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("notifies only active consumers once when a shared read fails", async () => {
    const response = deferred<ReturnType<typeof makeResponse>>();
    mockListGoogleDriveFiles.mockReturnValueOnce(response.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    let current = true;
    const obsolete = result.current.fetchFromApi("failing-folder", {
      canCommit: () => current,
    });
    const active = result.current.fetchFromApi("failing-folder");
    const otherActive = result.current.fetchFromApi("failing-folder");
    await Promise.resolve();
    current = false;
    response.reject(new TypeError("Failed to fetch"));
    await Promise.all([obsolete, active, otherActive]);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Network error. Check your connection.",
    );
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockListGoogleDriveFiles).toHaveBeenCalledTimes(1);
  });

  it("does not publish a response whose JSON finishes after an account change", async () => {
    const body = deferred<{ files: unknown[] }>();
    mockListGoogleDriveFiles.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => body.promise,
    });
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    const old = result.current.fetchFromApi("delayed-body");
    await Promise.resolve();
    await Promise.resolve();
    activeUserId = "account-two";
    body.resolve({ files: [{ id: "private", name: "Private.mp3" }] });
    expect(await old).toBeNull();
    expect(mockSetFiles).not.toHaveBeenCalled();
  });

  it("skips a folder read that became obsolete while cache hydration was pending", async () => {
    const hydration = deferred<void>();
    mockHydrate.mockReturnValueOnce(hydration.promise);
    const { renderHook } = await import("@testing-library/react");
    const { useFolderContents } = await import("./use-folder-contents");
    const { result } = renderHook(() => useFolderContents());
    let current = true;
    const onFiles = vi.fn();
    const onLoadingChange = vi.fn();
    const read = result.current.fetchFolderContents("old-folder", {
      onFiles,
      onLoadingChange,
      canCommit: () => current,
    });
    current = false;
    hydration.resolve();
    await read;
    expect(mockListGoogleDriveFiles).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
    expect(onLoadingChange).not.toHaveBeenCalled();
  });
});
