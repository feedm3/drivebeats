import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const authListeners = new Set<() => void>();
  const importsListeners = new Set<() => void>();
  const searchListeners = new Set<() => void>();
  return {
    auth: {
      authStatus: "authenticated",
      user: { id: "account" },
      isLoggingOut: false,
      accessToken: "original-token",
    },
    authListeners,
    importsListeners,
    searchListeners,
    search: {
      hydrated: true,
      invalidated: false,
      sessionOnly: false,
      buildProgress: 0,
      catalog: null as null | {
        userId: string;
        importsSignature: string;
        fetchedAt: number;
        tracks: { id: string; name: string; mimeType: string }[];
      },
      isStale: (): boolean => true,
      ensureReady: vi.fn(),
    },
    load: vi.fn(),
    save: vi.fn(),
    ensure: vi.fn(),
    getMetadata: vi.fn(),
    resolveKnown: vi.fn(),
    leader: vi.fn(),
    loadedCache: vi.fn(),
    retryAt: vi.fn(),
    coverage: vi.fn(),
    metadata: { records: {}, generation: 1, accountId: "account" },
  };
});
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: {
    getState: () => fixtures.auth,
    subscribe: (listener: () => void) => {
      fixtures.authListeners.add(listener);
      return () => fixtures.authListeners.delete(listener);
    },
  },
}));
vi.mock("@/stores/imported-drive-store", () => ({
  useImportedDriveStore: {
    persist: { hasHydrated: () => true },
    subscribe: (listener: () => void) => {
      fixtures.importsListeners.add(listener);
      return () => fixtures.importsListeners.delete(listener);
    },
  },
}));
vi.mock("@/stores/library-search-store", () => ({
  getLibrarySearchImportsSignature: () => "imports",
  useLibrarySearchStore: {
    getState: () => fixtures.search,
    subscribe: (listener: () => void) => {
      fixtures.searchListeners.add(listener);
      return () => fixtures.searchListeners.delete(listener);
    },
  },
}));
vi.mock("@/stores/id3-metadata-store", () => ({
  useId3MetadataStore: {
    subscribe: () => () => {},
    getState: () => ({
      ...fixtures.metadata,
      setAccount: async () => {},
      loadRecord: vi.fn(),
      peekRecord: fixtures.loadedCache,
    }),
  },
}));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: { getState: () => ({ isCloudHydrated: true }) },
}));
vi.mock("@/stores/playlist-store", () => ({
  usePlaylistStore: { getState: () => ({ isCloudHydrated: true }) },
}));
vi.mock("@/lib/background-progress-db", () => ({
  loadBackgroundProgress: fixtures.load,
  saveBackgroundProgress: fixtures.save,
}));
vi.mock("@/lib/track-metadata-loader", () => ({
  ensureTrackMetadata: fixtures.ensure,
  getTrackMetadataState: fixtures.getMetadata,
  getTrackMetadataRetryAt: fixtures.retryAt,
  useMetadataLoaderStore: {
    getState: () => ({ revision: 0 }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/lib/persisted-metadata-coverage", () => ({
  buildPersistedMetadataCoverage: fixtures.coverage,
}));
vi.mock("@/lib/known-track-resolver", () => ({
  getKnownTrackDescriptorRevision: () => 0,
  registerKnownFolder: vi.fn(),
  verifyKnownCollections: vi.fn(),
  resolveKnownTrack: fixtures.resolveKnown,
}));
vi.mock("@/lib/drive-request-scheduler", () => ({
  DriveDeferredError: class extends Error {},
  getDriveCoordinationStatus: () => ({
    available: true,
    cooldownUntil: 0,
    retryAfterMs: 0,
  }),
  isDriveBackgroundFenceCurrent: () => document.visibilityState === "visible",
  acquireDriveBackgroundLeader: fixtures.leader,
}));
let stop: (() => void) | undefined;
const track = (id: string) => ({
  id,
  name: `${id}.mp3`,
  mimeType: "audio/mpeg",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixtures.metadata.generation = 1;
  fixtures.auth.authStatus = "authenticated";
  fixtures.auth.isLoggingOut = false;
  fixtures.auth.accessToken = "original-token";
  fixtures.resolveKnown.mockImplementation(
    (_accountId: string, id: string) => ({ track: { id } }),
  );
  fixtures.auth.user.id = "account";
  fixtures.search.catalog = null;
  fixtures.search.isStale = () => true;
  fixtures.search.ensureReady.mockImplementation(
    (signal: AbortSignal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(false), { once: true });
      }),
  );
  fixtures.coverage.mockResolvedValue({
    ready: 0,
    noTargetTags: 0,
    unresolved: 0,
    stale: 0,
    errors: 0,
    unknown: 0,
    checked: 0,
    total: 0,
    remaining: 0,
    unresolvedReasons: {},
    fields: {},
    metadataSearchComplete: false,
  });
  fixtures.load.mockResolvedValue(undefined);
  fixtures.loadedCache.mockResolvedValue({ freshness: "unknown" });
  fixtures.retryAt.mockReturnValue(0);
  fixtures.save.mockResolvedValue(true);
  fixtures.ensure.mockResolvedValue({
    metadata: { status: "ready", freshness: "current" },
  });
  fixtures.getMetadata.mockReturnValue({
    status: "missing",
    freshness: "unknown",
  });
  fixtures.leader.mockImplementation(
    async (
      _account: string,
      signal: AbortSignal,
      callback: (fence: number, signal: AbortSignal) => Promise<void>,
    ) => callback(1, signal),
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: undefined,
  });
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(1);
  vi.useRealTimers();
});

async function module() {
  return import("./metadata-index-coordinator");
}

describe("automatic metadata coordinator", () => {
  it("starts the catalog without search and processes proven folder tracks while that build waits", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder(
      [{ id: "folder", name: "Music" }],
      [track("visible")],
    );
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.search.ensureReady).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      { background: true },
    );
    expect(fixtures.ensure.mock.calls[0]?.[0].track.id).toBe("visible");
    expect(fixtures.save.mock.calls[0]?.[2].isCurrent()).toBe(true);
  });

  it("resumes the persisted Library cursor and does not let resume events bypass retry delay", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], []);
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 1,
      tracks: [track("first"), track("second")],
    };
    fixtures.load.mockResolvedValue({ cursor: 1, retryAt: 0 });
    fixtures.ensure.mockResolvedValue({
      metadata: {
        status: "error",
        freshness: "unknown",
        error: { code: "rate_limited", retryAfterMs: 30_000 },
      },
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.ensure.mock.calls[0]?.[0].track.id).toBe("second");
    expect(fixtures.save.mock.calls[0]?.[1]).toMatchObject({ cursor: 0 });
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fixtures.ensure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_001);
    expect(fixtures.ensure).toHaveBeenCalledTimes(2);
  });

  it("does not publish a late checkpoint after account logout while extraction was pending", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], [track("late")]);
    let finish!: (value: unknown) => void;
    fixtures.ensure.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    fixtures.auth.isLoggingOut = true;
    for (const listener of fixtures.authListeners) listener();
    finish({ metadata: { status: "ready", freshness: "current" } });
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.save).not.toHaveBeenCalled();
  });

  it("does not start automatic work while hidden", async () => {
    const coordinator = await module();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(4000);
    expect(fixtures.leader).not.toHaveBeenCalled();
    expect(fixtures.search.ensureReady).not.toHaveBeenCalled();
    expect(coordinator.useMetadataIndexStore.getState().pauseReason).toBe(
      "hidden",
    );
  });
  it("coalesces persisted coverage and drops a complete aggregate immediately after a metadata revision", async () => {
    const coordinator = await module();
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 2,
      tracks: [track("evicted")],
    };
    fixtures.coverage.mockResolvedValue({
      ready: 1,
      noTargetTags: 0,
      unresolved: 0,
      stale: 0,
      errors: 0,
      unknown: 0,
      checked: 1,
      total: 1,
      remaining: 0,
      unresolvedReasons: {},
      fields: { artist: 1 },
      metadataSearchComplete: true,
    });
    const [a, b] = await Promise.all([
      coordinator.getMetadataIndexStatusAsync(),
      coordinator.getMetadataIndexStatusAsync(),
    ]);
    expect(fixtures.coverage).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({
      ready: 1,
      total: 1,
      coveragePending: false,
      indexingState: "complete",
    });
    expect(b).toMatchObject({ ready: 1, coveragePending: false });
    fixtures.metadata.records = {};
    expect(coordinator.getMetadataIndexStatus()).toMatchObject({
      coveragePending: true,
      metadataSearchComplete: false,
    });
  });

  it("does not publish an aggregate whose account logs out during its IndexedDB scan", async () => {
    const coordinator = await module();
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 3,
      tracks: [track("private")],
    };
    let finish!: (value: unknown) => void;
    fixtures.coverage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = coordinator.getMetadataIndexStatusAsync();
    fixtures.auth.isLoggingOut = true;
    finish({
      ready: 1,
      checked: 1,
      total: 1,
      remaining: 0,
      metadataSearchComplete: true,
    });
    expect(await pending).toMatchObject({
      total: null,
      metadataSearchComplete: false,
    });
  });
  it("keeps 3k-track status rendering constant-cost while row metadata revisions stream", async () => {
    const coordinator = await module();
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 10,
      tracks: Array.from({ length: 3000 }, (_, index) =>
        track(`perf-${index}`),
      ),
    };
    const startedAt = vi.getRealSystemTime();
    for (let tick = 0; tick < 100; tick++) {
      fixtures.metadata.records = {};
      coordinator.getMetadataIndexStatus();
    }
    const elapsed = vi.getRealSystemTime() - startedAt;
    expect(
      fixtures.getMetadata.mock.calls.length,
      `100 status renders over3k tracks took ${elapsed}ms and performed ${fixtures.getMetadata.mock.calls.length} per-track reads`,
    ).toBe(0);
  });
  it("never starts overlapping coverage scans when row revisions change during a slow local scan", async () => {
    const coordinator = await module();
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 11,
      tracks: Array.from({ length: 3000 }, (_, index) =>
        track(`scan-${index}`),
      ),
    };
    let finish!: (value: unknown) => void;
    fixtures.coverage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = [coordinator.getMetadataIndexStatusAsync()];
    for (let tick = 0; tick < 50; tick++) {
      fixtures.metadata.records = {};
      pending.push(coordinator.getMetadataIndexStatusAsync());
    }
    expect(fixtures.coverage).toHaveBeenCalledTimes(1);
    finish({
      ready: 0,
      noTargetTags: 0,
      unresolved: 0,
      stale: 0,
      errors: 0,
      unknown: 3000,
      checked: 0,
      total: 3000,
      remaining: 3000,
      unresolvedReasons: {},
      fields: {},
      metadataSearchComplete: false,
    });
    await Promise.all(pending);
    expect(fixtures.coverage).toHaveBeenCalledTimes(1);
  });
  it("pauses automatic Library warming for Save-Data and resumes when the optional hint changes", async () => {
    const coordinator = await module();
    const connection = Object.assign(new EventTarget(), {
      saveData: true,
      effectiveType: "4g",
    });
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: connection,
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.search.ensureReady).not.toHaveBeenCalled();
    expect(coordinator.useMetadataIndexStore.getState().pauseReason).toBe(
      "data_saver",
    );
    connection.saveData = false;
    connection.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.search.ensureReady).toHaveBeenCalledOnce();
  });
  it("checks at most100 cached tracks per pass and sleeps after a complete3k generation", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], []);
    fixtures.search.isStale = () => false;
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 12,
      tracks: Array.from({ length: 3000 }, (_, index) =>
        track(`cached-${index}`),
      ),
    };
    fixtures.loadedCache.mockResolvedValue({
      freshness: "current",
      record: { status: "ready" },
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.loadedCache).toHaveBeenCalledTimes(100);
    await vi.advanceTimersByTimeAsync(3100);
    expect(fixtures.loadedCache).toHaveBeenCalledTimes(3000);
    expect(fixtures.save.mock.calls.at(-1)?.[1]).toHaveProperty("completed");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fixtures.loadedCache).toHaveBeenCalledTimes(3000);
    expect(fixtures.ensure).not.toHaveBeenCalled();
  });

  it("restarts a completed Library scan after the local metadata cache is reset", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], []);
    fixtures.search.isStale = () => false;
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 12,
      tracks: [track("cached")],
    };
    fixtures.loadedCache.mockResolvedValue({
      freshness: "current",
      record: { status: "ready" },
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixtures.ensure).not.toHaveBeenCalled();
    fixtures.metadata.generation += 1;
    fixtures.loadedCache.mockResolvedValue({ freshness: "unknown" });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(fixtures.ensure).toHaveBeenCalledOnce();
  });

  it("skips one failed visible track's backoff and continues to healthy Library tracks", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], [track("bad")]);
    fixtures.search.isStale = () => false;
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 13,
      tracks: [track("bad"), track("good")],
    };
    let badRetry = 0;
    fixtures.retryAt.mockImplementation((known) =>
      known.track.id === "bad" ? badRetry : 0,
    );
    fixtures.ensure.mockImplementation(async (known) => {
      if (known.track.id === "bad") {
        badRetry = Date.now() + 30_000;
        return {
          metadata: {
            status: "error",
            freshness: "unknown",
            error: { code: "network_error", retryAfterMs: 30_000 },
          },
        };
      }
      return { metadata: { status: "ready", freshness: "current" } };
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixtures.ensure.mock.calls.map(([known]) => known.track.id)).toEqual(
      ["bad", "good"],
    );
  });
  it("retains last observed counts through same-scope warming and discards them for a new catalog", async () => {
    const coordinator = await module();
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 20,
      tracks: Array.from({ length: 2913 }, (_, index) =>
        track(`stable-${index}`),
      ),
    };
    fixtures.coverage.mockResolvedValue({
      ready: 82,
      noTargetTags: 0,
      unresolved: 4,
      stale: 0,
      errors: 0,
      unknown: 2827,
      checked: 82,
      total: 2913,
      remaining: 2827,
      unresolvedReasons: { parse_error: 2, budget_exceeded: 2 },
      fields: {},
      metadataSearchComplete: false,
    });
    const first = await coordinator.getMetadataIndexStatusAsync();
    fixtures.metadata.records = {};
    expect(coordinator.getMetadataIndexStatus()).toMatchObject({
      checked: 82,
      total: 2913,
      coveragePending: true,
      coverageScopeVersion: first.coverageScopeVersion,
      observedAt: first.observedAt,
    });
    fixtures.search.catalog = { ...fixtures.search.catalog, fetchedAt: 21 };
    const changed = coordinator.getMetadataIndexStatus();
    expect(changed).toMatchObject({
      checked: 0,
      coveragePending: true,
      observedAt: null,
    });
    expect(changed.coverageScopeVersion).not.toBe(first.coverageScopeVersion);
  });
  it("excludes subfolders, including a folder named.mp3, and completes without a35-second retry", async () => {
    const coordinator = await module();
    const folders = [
      {
        id: "folder",
        name: "Albums",
        mimeType: "application/vnd.google-apps.folder",
      },
      {
        id: "fake-mp3",
        name: "Mix.mp3",
        mimeType: "application/vnd.google-apps.folder",
      },
    ];
    fixtures.resolveKnown.mockImplementation(
      (_accountId: string, id: string) =>
        folders.some((folder) => folder.id === id) ? null : { track: { id } },
    );
    coordinator.setCurrentMetadataFolder([], [...folders, track("audio")]);
    fixtures.search.isStale = () => false;
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 30,
      tracks: [track("audio")],
    };
    fixtures.loadedCache.mockResolvedValue({
      freshness: "current",
      record: { status: "ready" },
    });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixtures.save.mock.calls.at(-1)?.[1]).toHaveProperty("completed");
    const reads = fixtures.loadedCache.mock.calls.length;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(fixtures.loadedCache).toHaveBeenCalledTimes(reads);
    expect(
      fixtures.resolveKnown.mock.calls.some(([, id]) =>
        folders.some((folder) => folder.id === id),
      ),
    ).toBe(false);
  });

  it.each(["metadata_auth_required", "metadata_setup_error"])(
    "pauses the metadata queue on%s and retries one track rather than walking the Library",
    async (code) => {
      const coordinator = await module();
      coordinator.setCurrentMetadataFolder([], []);
      fixtures.search.isStale = () => false;
      fixtures.search.catalog = {
        userId: "account",
        importsSignature: "imports",
        fetchedAt: 31,
        tracks: [track("first"), track("second")],
      };
      fixtures.ensure.mockResolvedValue({
        metadata: {
          status: "error",
          freshness: "unknown",
          error: { code, retryable: true, retryAfterMs: 30000 },
        },
      });
      stop = coordinator.startMetadataIndex();
      await vi.advanceTimersByTimeAsync(1);
      expect(
        fixtures.ensure.mock.calls.map(([known]) => known.track.id),
      ).toEqual(["first"]);
      expect(coordinator.useMetadataIndexStore.getState()).toMatchObject({
        running: false,
        pauseReason: code,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fixtures.ensure).toHaveBeenCalledOnce();
      expect(fixtures.auth).toMatchObject({
        authStatus: "authenticated",
        accessToken: "original-token",
        isLoggingOut: false,
      });
      await vi.advanceTimersByTimeAsync(240_001);
      expect(
        fixtures.ensure.mock.calls.map(([known]) => known.track.id),
      ).toEqual(["first", "first"]);
    },
  );

  it("lets a healthy track proceed after a consumer budget deferral", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], []);
    fixtures.search.isStale = () => false;
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 32,
      tracks: [track("limited"), track("healthy")],
    };
    fixtures.ensure.mockImplementation(async (known) =>
      known.track.id === "limited"
        ? {
            metadata: {
              status: "deferred",
              freshness: "unknown",
              error: {
                code: "budget_exceeded",
                budgetScope: "consumer",
                retryable: true,
                retryAfterMs: 30000,
              },
            },
          }
        : { metadata: { status: "ready", freshness: "current" } },
    );
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixtures.ensure.mock.calls.map(([known]) => known.track.id)).toEqual(
      ["limited", "healthy"],
    );
  });
  it("resumes the blocked track after a real sign-in token change without persisting credentials", async () => {
    const coordinator = await module();
    coordinator.setCurrentMetadataFolder([], []);
    fixtures.search.isStale = () => false;
    fixtures.search.catalog = {
      userId: "account",
      importsSignature: "imports",
      fetchedAt: 33,
      tracks: [track("blocked"), track("next")],
    };
    fixtures.ensure
      .mockResolvedValueOnce({
        metadata: {
          status: "error",
          freshness: "unknown",
          error: {
            code: "metadata_auth_required",
            retryable: true,
            retryAfterMs: 30000,
          },
        },
      })
      .mockResolvedValue({
        metadata: { status: "ready", freshness: "current" },
      });
    stop = coordinator.startMetadataIndex();
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.stringify(fixtures.save.mock.calls[0]?.[1])).not.toContain(
      "original-token",
    );
    fixtures.auth.accessToken = "renewed-token";
    for (const listener of fixtures.authListeners) listener();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixtures.ensure.mock.calls.map(([known]) => known.track.id)).toEqual(
      ["blocked", "blocked", "next"],
    );
    expect(fixtures.auth).toMatchObject({
      accessToken: "renewed-token",
      authStatus: "authenticated",
      isLoggingOut: false,
    });
  });
});
