import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineTrackRecord } from "@/lib/offline-db";
import type { OfflineDownloadManagerDependencies } from "@/lib/offline-download-manager";
import type { PlaylistTrack } from "@/types";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

type Database = OfflineDownloadManagerDependencies["database"];
type CollectionRecord = Parameters<Database["putCollection"]>[1];

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function track(fileId: string): PlaylistTrack {
  return {
    fileId,
    fileName: `${fileId}.mp3`,
    mimeType: "audio/mpeg",
    modifiedTime: "2026-07-29T12:00:00.000Z",
    size: "5",
  };
}

function mediaResponse(body = "12345", status = 200): Response {
  const blob = new Blob([body], { type: "audio/mpeg" });
  return {
    ok: status >= 200 && status < 300,
    status,
    blob: () => Promise.resolve(blob),
  } as Response;
}

function metadataResponse(item: PlaylistTrack): Response {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        id: item.fileId,
        size: item.size,
        modifiedTime: item.modifiedTime,
      }),
  } as Response;
}

function errorResponse(
  status: number,
  options: { reason?: string; retryAfter?: string } = {},
): Response {
  const response = {
    ok: false,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after"
          ? (options.retryAfter ?? null)
          : null,
    },
    json: () =>
      Promise.resolve({
        error: { errors: [{ reason: options.reason }] },
      }),
  };
  return {
    ...response,
    clone: () => errorResponse(status, options),
  } as unknown as Response;
}

function createLifecycleFake() {
  const onlineListeners = new Set<() => void>();
  const addOnlineListener = vi.fn((listener: () => void) => {
    onlineListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      onlineListeners.delete(listener);
    };
  });

  return {
    adapter: { addOnlineListener },
    addOnlineListener,
    emitOnline() {
      for (const listener of [...onlineListeners]) listener();
    },
    activeOnlineListenerCount() {
      return onlineListeners.size;
    },
  };
}

function createDatabaseFake() {
  const tracks = new Map<string, OfflineTrackRecord>();
  const collections = new Map<string, CollectionRecord>();

  const database: Database = {
    clearAll: vi.fn(async () => {
      tracks.clear();
      collections.clear();
    }),
    deleteCollection: vi.fn(async (collectionId) => {
      collections.delete(collectionId);
    }),
    deleteTrack: vi.fn(async (fileId) => {
      tracks.delete(fileId);
    }),
    getAllTrackSizes: vi.fn(async () =>
      [...tracks].map(([fileId, record]) => ({
        fileId,
        sizeBytes: record.sizeBytes,
      })),
    ),
    getTrack: vi.fn(async (fileId) => tracks.get(fileId)),
    putCollection: vi.fn(async (collectionId, record) => {
      collections.set(collectionId, record);
    }),
    putTrack: vi.fn(async (fileId, record) => {
      tracks.set(fileId, record);
    }),
  };

  return { database, tracks, collections };
}

async function loadTestRealm(
  overrides: Partial<OfflineDownloadManagerDependencies> = {},
) {
  localStorage.clear();
  vi.resetModules();

  const [
    managerModule,
    offlineStoreModule,
    libraryStoreModule,
    playlistStoreModule,
    authStoreModule,
  ] = await Promise.all([
    import("@/lib/offline-download-manager"),
    import("@/stores/offline-store"),
    import("@/stores/library-store"),
    import("@/stores/playlist-store"),
    import("@/stores/auth-store"),
  ]);

  const lifecycle = createLifecycleFake();
  const databaseFake = createDatabaseFake();
  const defaultDrive = {
    downloadFileMedia: vi.fn(async () => mediaResponse()),
    getFileMetadata: vi.fn(async (fileId: string) =>
      metadataResponse(track(fileId)),
    ),
  };
  const dependencies: OfflineDownloadManagerDependencies = {
    drive: overrides.drive ?? defaultDrive,
    database: overrides.database ?? databaseFake.database,
    clock: overrides.clock ?? {
      now: () => Date.now(),
      sleep: async () => undefined,
    },
    lifecycle: overrides.lifecycle ?? lifecycle.adapter,
  };

  const manager = managerModule.createOfflineDownloadManager(dependencies);
  const { useOfflineStore } = offlineStoreModule;
  const { useLibraryStore } = libraryStoreModule;
  const { usePlaylistStore } = playlistStoreModule;
  const { useAuthStore } = authStoreModule;

  useOfflineStore.getState().clearAll();
  useLibraryStore.setState({
    tracks: {},
    isCloudHydrated: false,
    isCloudSyncing: false,
  });
  usePlaylistStore.setState({
    playlists: [],
    activePlaylistId: null,
    isCloudHydrated: false,
    isCloudSyncing: false,
  });
  useAuthStore.setState({
    accessToken: "access-token",
    expiresAt: Date.now() + 3_600_000,
    authStatus: "authenticated",
    getValidAccessToken: async () => "access-token",
    refreshAccessToken: async () => true,
  });

  return {
    manager,
    dependencies,
    lifecycle,
    databaseFake,
    useOfflineStore,
    useLibraryStore,
    usePlaylistStore,
    useAuthStore,
  };
}

function seedPlaylist(
  usePlaylistStore: Awaited<
    ReturnType<typeof loadTestRealm>
  >["usePlaylistStore"],
  collectionId: string,
  tracks: PlaylistTrack[],
  isCloudHydrated = true,
) {
  usePlaylistStore.setState({
    playlists: [{ id: collectionId, name: collectionId, tracks }],
    isCloudHydrated,
  });
}

function storedTrack(item: PlaylistTrack): OfflineTrackRecord {
  return {
    blob: new Blob(["12345"], { type: "audio/mpeg" }),
    sizeBytes: 5,
    mimeType: "audio/mpeg",
    name: item.fileName,
    modifiedTime: item.modifiedTime,
    downloadedAt: 1,
  };
}

async function flushMicrotasks(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("offline download manager reconciliation and drain", () => {
  it("keeps cloud additions made while recovery scans the original 21 tracks", async () => {
    const scan = deferred<{ fileId: string; sizeBytes: number }[]>();
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async (fileId: string) =>
        metadataResponse(track(fileId)),
      ),
    };
    const realm = await loadTestRealm({ drive });
    const original = Array.from({ length: 21 }, (_, index) =>
      track(`original-${index + 1}`),
    );
    const additions = Array.from({ length: 3 }, (_, index) =>
      track(`cloud-${index + 1}`),
    );

    realm.useLibraryStore.setState({
      tracks: Object.fromEntries(
        original.map((item) => [
          item.fileId,
          { ...item, isFavorite: true, playCount: 0 },
        ]),
      ),
      isCloudHydrated: true,
    });
    realm.useOfflineStore.getState().enableCollection(
      "system:favorites",
      original.map(({ fileId }) => fileId),
    );
    for (const item of original) {
      realm.useOfflineStore
        .getState()
        .updateTrackStatus(item.fileId, "downloaded");
      realm.databaseFake.tracks.set(item.fileId, storedTrack(item));
    }
    vi.mocked(realm.dependencies.database.getAllTrackSizes).mockReturnValueOnce(
      scan.promise,
    );

    realm.manager.start();
    realm.useLibraryStore.setState({
      tracks: Object.fromEntries(
        [...original, ...additions].map((item) => [
          item.fileId,
          { ...item, isFavorite: true, playCount: 0 },
        ]),
      ),
      isCloudHydrated: true,
    });

    scan.resolve(original.map(({ fileId }) => ({ fileId, sizeBytes: 5 })));
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledTimes(3);
    });
    await flushMicrotasks(16);

    const state = realm.useOfflineStore.getState();
    expect(state.collections["system:favorites"]?.trackFileIds).toHaveLength(
      24,
    );
    expect(state.collections["system:favorites"]?.downloadedCount).toBe(24);
    for (const item of additions) {
      expect(state.trackStatus[item.fileId]).toBe("downloaded");
    }
  });

  it("drains work added while another media request is active", async () => {
    const firstResponse = deferred<Response>();
    const first = track("first");
    const second = track("second");
    const drive = {
      downloadFileMedia: vi.fn((fileId: string) =>
        fileId === first.fileId
          ? firstResponse.promise
          : Promise.resolve(mediaResponse()),
      ),
      getFileMetadata: vi.fn(async (fileId: string) =>
        metadataResponse(track(fileId)),
      ),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [first]);
    realm.manager.start();

    const initialDrain = realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledWith(
        first.fileId,
        "access-token",
        expect.any(AbortSignal),
      );
    });

    seedPlaylist(realm.usePlaylistStore, "mix", [first, second]);
    firstResponse.resolve(mediaResponse());
    await initialDrain;

    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledWith(
        second.fileId,
        "access-token",
        expect.any(AbortSignal),
      );
      expect(realm.useOfflineStore.getState().trackStatus[second.fileId]).toBe(
        "downloaded",
      );
    });
  });

  it("keeps a queued track pending until authoritative cloud metadata arrives", async () => {
    const lateTrack = track("late");
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(lateTrack)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [], false);
    realm.useOfflineStore
      .getState()
      .enableCollection("mix", [lateTrack.fileId]);

    realm.manager.start();
    await flushMicrotasks();

    expect(realm.useOfflineStore.getState().trackStatus[lateTrack.fileId]).toBe(
      "queued",
    );
    expect(drive.downloadFileMedia).not.toHaveBeenCalled();

    seedPlaylist(realm.usePlaylistStore, "mix", [lateTrack], true);

    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
      expect(
        realm.useOfflineStore.getState().trackStatus[lateTrack.fileId],
      ).toBe("downloaded");
    });
  });

  it("preserves unhydrated intent and applies the first authoritative cloud projection", async () => {
    const previous = track("previous");
    const current = track("current");
    const realm = await loadTestRealm();
    realm.useOfflineStore.getState().enableCollection("mix", [previous.fileId]);
    realm.databaseFake.tracks.set(previous.fileId, storedTrack(previous));
    realm.usePlaylistStore.setState({
      playlists: [],
      isCloudHydrated: false,
    });

    realm.manager.start();
    await vi.waitFor(() => {
      expect(
        realm.useOfflineStore.getState().trackStatus[previous.fileId],
      ).toBe("downloaded");
    });

    expect(
      realm.useOfflineStore.getState().collections.mix?.trackFileIds,
    ).toEqual([previous.fileId]);
    expect(realm.dependencies.database.deleteTrack).not.toHaveBeenCalled();

    seedPlaylist(realm.usePlaylistStore, "mix", [current], true);

    await vi.waitFor(() => {
      expect(
        realm.useOfflineStore.getState().collections.mix?.trackFileIds,
      ).toEqual([current.fileId]);
      expect(realm.useOfflineStore.getState().trackStatus[current.fileId]).toBe(
        "downloaded",
      );
      expect(realm.dependencies.database.deleteTrack).toHaveBeenCalledWith(
        previous.fileId,
      );
    });
  });

  it("capacity-checks tracks discovered by a later cloud batch", async () => {
    const estimate = vi
      .fn()
      .mockResolvedValueOnce({ quota: 100, usage: 0 })
      .mockResolvedValueOnce({ quota: 100, usage: 0 })
      .mockResolvedValue({ quota: 5, usage: 5 });
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn(async () => true),
        persist: vi.fn(async () => true),
        estimate,
      },
    });
    const first = track("capacity-first");
    const cloudAddition = track("capacity-added");
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async (fileId: string) =>
        metadataResponse(track(fileId)),
      ),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [first]);
    realm.manager.start();

    await realm.manager.ensureCollectionAvailableOffline("mix");
    expect(realm.useOfflineStore.getState().trackStatus[first.fileId]).toBe(
      "downloaded",
    );

    seedPlaylist(realm.usePlaylistStore, "mix", [first, cloudAddition]);

    await vi.waitFor(() => {
      expect(
        realm.useOfflineStore.getState().trackJobs[cloudAddition.fileId],
      ).toMatchObject({
        status: "failed",
        errorCategory: "storage-full",
      });
    });
    expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
  });

  it("lets a bounded, unavailable capacity estimate fall back to guarded writes", async () => {
    vi.useFakeTimers();
    const estimate = vi
      .fn()
      .mockResolvedValueOnce({ quota: 100, usage: 0 })
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn(async () => true),
        persist: vi.fn(async () => true),
        estimate,
      },
    });
    const item = track("hung-capacity");
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.manager.start();

    const enable = realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.advanceTimersByTimeAsync(15_001);
    await enable;

    expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });

  it("does not let a stale capacity estimate fail the resumed generation", async () => {
    const staleEstimate = deferred<{ quota: number; usage: number } | null>();
    const estimate = vi
      .fn()
      .mockResolvedValueOnce({ quota: 100, usage: 0 })
      .mockReturnValueOnce(staleEstimate.promise)
      .mockResolvedValue({ quota: 100, usage: 0 });
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn(async () => true),
        persist: vi.fn(async () => true),
        estimate,
      },
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const item = track("stale-capacity");
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.manager.start();

    const enable = realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => expect(estimate).toHaveBeenCalledTimes(2));
    document.dispatchEvent(new Event("visibilitychange"));
    staleEstimate.resolve({ quota: 1, usage: 1 });
    await enable;

    await vi.waitFor(() => {
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId]?.errorCategory,
    ).toBeUndefined();
  });

  it("lets an actual IndexedDB record override a persisted failed projection", async () => {
    const item = track("stored-overrides-failed");
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.useOfflineStore.getState().enableCollection("mix", [item.fileId]);
    realm.useOfflineStore.getState().updateTrackJob(item.fileId, {
      status: "failed",
      phase: "idle",
      attempt: 2,
      errorCategory: "network",
    });
    realm.databaseFake.tracks.set(item.fileId, storedTrack(item));

    realm.manager.start();

    await vi.waitFor(() => {
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
  });
});

describe("offline download manager lifecycle and cancellation", () => {
  it("reference-counts start cleanup across a Strict Mode remount", async () => {
    const realm = await loadTestRealm();

    const cleanupFirst = realm.manager.start();
    const cleanupSecond = realm.manager.start();
    expect(realm.lifecycle.activeOnlineListenerCount()).toBe(1);

    cleanupFirst();
    expect(realm.lifecycle.activeOnlineListenerCount()).toBe(1);

    cleanupSecond();
    cleanupSecond();
    expect(realm.lifecycle.activeOnlineListenerCount()).toBe(0);

    const cleanupRemount = realm.manager.start();
    expect(realm.lifecycle.addOnlineListener).toHaveBeenCalledTimes(2);
    expect(realm.lifecycle.activeOnlineListenerCount()).toBe(1);
    cleanupRemount();
  });

  it("coalesces a pageshow, visible, and online burst into one reconciliation", async () => {
    const realm = await loadTestRealm();
    const item = track("stored");
    realm.useOfflineStore.getState().enableCollection("mix", [item.fileId]);
    realm.databaseFake.tracks.set(item.fileId, storedTrack(item));
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    realm.manager.start();
    await vi.waitFor(() => {
      expect(
        realm.dependencies.database.getAllTrackSizes,
      ).toHaveBeenCalledOnce();
    });

    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    realm.lifecycle.emitOnline();

    await vi.waitFor(() => {
      expect(
        realm.dependencies.database.getAllTrackSizes,
      ).toHaveBeenCalledTimes(2);
    });
    await flushMicrotasks();
    expect(realm.dependencies.database.getAllTrackSizes).toHaveBeenCalledTimes(
      2,
    );
  });

  it("removes and re-enables a complete collection without a stale cancellation marker", async () => {
    const item = track("repeat");
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);

    await realm.manager.ensureCollectionAvailableOffline("mix");
    await realm.manager.removeCollectionDownloads("mix");
    await realm.manager.ensureCollectionAvailableOffline("mix");

    expect(drive.downloadFileMedia).toHaveBeenCalledTimes(2);
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });

  it("deletes a shared Blob only after its last collection reference is removed", async () => {
    const shared = track("shared");
    const realm = await loadTestRealm();
    realm.usePlaylistStore.setState({
      playlists: [
        { id: "first", name: "first", tracks: [shared] },
        { id: "second", name: "second", tracks: [shared] },
      ],
      isCloudHydrated: true,
    });

    await realm.manager.ensureCollectionAvailableOffline("first");
    await realm.manager.ensureCollectionAvailableOffline("second");
    await realm.manager.removeCollectionDownloads("first");

    expect(realm.dependencies.database.deleteTrack).not.toHaveBeenCalled();
    expect(realm.databaseFake.tracks.has(shared.fileId)).toBe(true);
    expect(realm.useOfflineStore.getState().refCounts[shared.fileId]).toBe(1);

    await realm.manager.removeCollectionDownloads("second");
    expect(realm.dependencies.database.deleteTrack).toHaveBeenCalledOnce();
    expect(realm.databaseFake.tracks.has(shared.fileId)).toBe(false);
  });

  it("cancels an active last-reference download without creating a failure", async () => {
    const item = track("cancelled");
    let requestSignal: AbortSignal | undefined;
    const response = deferred<Response>();
    const drive = {
      downloadFileMedia: vi.fn(
        async (_fileId: string, _token: string, signal?: AbortSignal) => {
          requestSignal = signal;
          return response.promise;
        },
      ),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);

    const drain = realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await realm.manager.removeCollectionDownloads("mix");

    expect(requestSignal?.aborted).toBe(true);
    response.reject(new DOMException("Removed", "AbortError"));
    await drain;
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toBeUndefined();
    expect(realm.databaseFake.tracks.has(item.fileId)).toBe(false);
  });

  it("supersedes unresolved work on visible resume without surfacing a failure", async () => {
    const item = track("foreground");
    let firstSignal: AbortSignal | undefined;
    const drive = {
      downloadFileMedia: vi
        .fn()
        .mockImplementationOnce(
          (_fileId: string, _token: string, signal?: AbortSignal) => {
            firstSignal = signal;
            return new Promise<Response>((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Superseded", "AbortError")),
                { once: true },
              );
            });
          },
        )
        .mockResolvedValueOnce(mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    realm.manager.start();

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
      expect(drive.downloadFileMedia).toHaveBeenCalledTimes(2);
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
      expect(
        realm.useOfflineStore.getState().trackJobs[item.fileId]?.errorCategory,
      ).toBeUndefined();
      expect(
        realm.useOfflineStore.getState().trackJobs[item.fileId]?.attempt,
      ).toBe(1);
    });
  });

  it("does not let a timed-out stale write delete a re-enabled replacement", async () => {
    vi.useFakeTimers();
    const item = track("overlapping-reenable");
    const staleWrite = deferred<void>();
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.mocked(realm.dependencies.database.putTrack)
      .mockImplementationOnce(async (fileId, record) => {
        await staleWrite.promise;
        realm.databaseFake.tracks.set(fileId, record);
      })
      .mockImplementationOnce(async (fileId, record) => {
        realm.databaseFake.tracks.set(fileId, record);
      });

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(realm.dependencies.database.putTrack).toHaveBeenCalledOnce();
    });
    await vi.advanceTimersByTimeAsync(15_001);
    await realm.manager.removeCollectionDownloads("mix");
    await realm.manager.ensureCollectionAvailableOffline("mix");

    expect(realm.dependencies.database.putTrack).toHaveBeenCalledTimes(2);
    expect(realm.databaseFake.tracks.has(item.fileId)).toBe(true);

    staleWrite.resolve();
    await flushMicrotasks(16);

    expect(realm.databaseFake.tracks.has(item.fileId)).toBe(true);
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });

  it("repairs a shared Blob when a new reference arrives during deletion", async () => {
    const item = track("concurrent-reference");
    const deletion = deferred<void>();
    const realm = await loadTestRealm();
    realm.usePlaylistStore.setState({
      playlists: [
        { id: "first", name: "first", tracks: [item] },
        { id: "second", name: "second", tracks: [item] },
      ],
      isCloudHydrated: true,
    });
    await realm.manager.ensureCollectionAvailableOffline("first");
    vi.mocked(realm.dependencies.database.deleteTrack).mockImplementationOnce(
      async (fileId) => {
        await deletion.promise;
        realm.databaseFake.tracks.delete(fileId);
      },
    );

    const removal = realm.manager.removeCollectionDownloads("first");
    await vi.waitFor(() => {
      expect(realm.dependencies.database.deleteTrack).toHaveBeenCalledOnce();
    });
    const enable = realm.manager.ensureCollectionAvailableOffline("second");
    deletion.resolve();
    await Promise.all([removal, enable]);

    await vi.waitFor(() => {
      expect(realm.databaseFake.tracks.has(item.fileId)).toBe(true);
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
  });

  it("repairs a newly referenced Blob after a timed-out deletion commits late", async () => {
    vi.useFakeTimers();
    const item = track("late-delete");
    const deletion = deferred<void>();
    const realm = await loadTestRealm();
    realm.usePlaylistStore.setState({
      playlists: [
        { id: "first", name: "first", tracks: [item] },
        { id: "second", name: "second", tracks: [item] },
      ],
      isCloudHydrated: true,
    });
    await realm.manager.ensureCollectionAvailableOffline("first");
    vi.mocked(realm.dependencies.database.deleteTrack).mockImplementationOnce(
      async (fileId) => {
        await deletion.promise;
        realm.databaseFake.tracks.delete(fileId);
      },
    );

    const removal = realm.manager.removeCollectionDownloads("first");
    await vi.waitFor(() => {
      expect(realm.dependencies.database.deleteTrack).toHaveBeenCalledOnce();
    });
    await realm.manager.ensureCollectionAvailableOffline("second");
    const removalResult = expect(removal).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_001);
    await removalResult;

    deletion.resolve();
    await vi.waitFor(() => {
      expect(realm.databaseFake.tracks.has(item.fileId)).toBe(true);
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
  });

  it("prevents a stale IndexedDB completion from repopulating remove-all state", async () => {
    const item = track("stale");
    const put = deferred<void>();
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.mocked(realm.dependencies.database.putTrack).mockImplementationOnce(
      async (fileId, record) => {
        await put.promise;
        realm.databaseFake.tracks.set(fileId, record);
      },
    );

    const drain = realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(realm.dependencies.database.putTrack).toHaveBeenCalledOnce();
    });
    await realm.manager.removeAllDownloads();
    put.resolve();
    await drain;

    expect(realm.databaseFake.tracks.size).toBe(0);
    expect(realm.useOfflineStore.getState().collections).toEqual({});
    expect(realm.useOfflineStore.getState().trackJobs).toEqual({});
  });

  it("keeps a completed Blob committed during lifecycle supersession", async () => {
    const item = track("late-lifecycle-commit");
    const put = deferred<void>();
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(realm.dependencies.database.putTrack).mockImplementationOnce(
      async (fileId, record) => {
        await put.promise;
        realm.databaseFake.tracks.set(fileId, record);
      },
    );
    realm.manager.start();

    const drain = realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(realm.dependencies.database.putTrack).toHaveBeenCalledOnce();
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();
    put.resolve();
    await drain;

    await vi.waitFor(() => {
      expect(realm.databaseFake.tracks.has(item.fileId)).toBe(true);
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
    expect(realm.dependencies.database.deleteTrack).not.toHaveBeenCalled();
  });
});

describe("offline download manager timeout and authentication readiness", () => {
  it("times out a hung media request, releases it, and succeeds on retry", async () => {
    vi.useFakeTimers();
    const item = track("hung");
    let firstSignal: AbortSignal | undefined;
    const drive = {
      downloadFileMedia: vi
        .fn()
        .mockImplementationOnce(
          (_fileId: string, _token: string, signal?: AbortSignal) => {
            firstSignal = signal;
            return new Promise<Response>((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Timed out", "AbortError")),
                { once: true },
              );
            });
          },
        )
        .mockResolvedValueOnce(mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    await vi.advanceTimersByTimeAsync(30_001);

    expect(firstSignal?.aborted).toBe(true);
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      phase: "idle",
      errorCategory: "timeout",
    });

    await realm.manager.retryDownloads("mix");
    expect(drive.downloadFileMedia).toHaveBeenCalledTimes(2);
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });

  it("keeps unknown authentication pending and resumes on auth readiness", async () => {
    const item = track("auth-pending");
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.useOfflineStore.getState().enableCollection("mix", [item.fileId]);
    realm.useAuthStore.setState({
      accessToken: null,
      expiresAt: null,
      authStatus: "unknown",
      getValidAccessToken: async () => null,
      refreshAccessToken: async () => false,
    });

    realm.manager.start();
    await vi.waitFor(() => {
      expect(
        realm.useOfflineStore.getState().trackJobs[item.fileId],
      ).toMatchObject({
        status: "queued",
        phase: "idle",
        attempt: 0,
      });
    });
    expect(drive.downloadFileMedia).not.toHaveBeenCalled();

    realm.useAuthStore.setState({
      accessToken: "ready-token",
      expiresAt: Date.now() + 3_600_000,
      authStatus: "authenticated",
      getValidAccessToken: async () => "ready-token",
    });

    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
  });

  it("labels only authoritative unauthenticated state as auth-required", async () => {
    const item = track("sign-in");
    const drive = {
      downloadFileMedia: vi.fn(async () => mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.useOfflineStore.getState().enableCollection("mix", [item.fileId]);
    realm.useAuthStore.setState({
      accessToken: null,
      expiresAt: null,
      authStatus: "unauthenticated",
      getValidAccessToken: async () => null,
      refreshAccessToken: async () => false,
    });

    realm.manager.start();

    await vi.waitFor(() => {
      expect(
        realm.useOfflineStore.getState().trackJobs[item.fileId],
      ).toMatchObject({
        status: "failed",
        phase: "idle",
        errorCategory: "auth-required",
      });
    });
    expect(drive.downloadFileMedia).not.toHaveBeenCalled();
  });
});

describe("offline download manager failure policy", () => {
  it("refreshes once after a 401 and continues with the replacement token", async () => {
    const item = track("refresh");
    const drive = {
      downloadFileMedia: vi
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.useAuthStore.setState({
      refreshAccessToken: async () => {
        realm.useAuthStore.setState({
          accessToken: "replacement-token",
          expiresAt: Date.now() + 3_600_000,
          authStatus: "authenticated",
        });
        return true;
      },
    });

    await realm.manager.ensureCollectionAvailableOffline("mix");

    expect(drive.downloadFileMedia).toHaveBeenNthCalledWith(
      2,
      item.fileId,
      "replacement-token",
      expect.any(AbortSignal),
    );
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });

  it("keeps 404 permanent and visible without a hot loop", async () => {
    vi.useFakeTimers();
    const item = track("missing");
    const drive = {
      downloadFileMedia: vi.fn(async () => errorResponse(404)),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);

    await realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      errorCategory: "missing-file",
    });
  });

  it("retries a Google rate-limit 403 but blocks permission-denied 403", async () => {
    const rateLimited = track("rate-limited");
    const denied = track("denied");
    const drive = {
      downloadFileMedia: vi.fn(async (fileId: string) =>
        fileId === rateLimited.fileId
          ? errorResponse(403, {
              reason: "rateLimitExceeded",
              retryAfter: "999999",
            })
          : errorResponse(403, { reason: "insufficientFilePermissions" }),
      ),
      getFileMetadata: vi.fn(async (fileId: string) =>
        metadataResponse(track(fileId)),
      ),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [rateLimited, denied]);
    const before = Date.now();

    await realm.manager.ensureCollectionAvailableOffline("mix");

    const jobs = realm.useOfflineStore.getState().trackJobs;
    expect(jobs[rateLimited.fileId]).toMatchObject({
      errorCategory: "rate-limited",
    });
    expect(jobs[rateLimited.fileId].nextAttemptAt).toBeLessThanOrEqual(
      before + 5 * 60_000 + 100,
    );
    expect(jobs[denied.fileId]).toMatchObject({
      errorCategory: "access-denied",
      nextAttemptAt: undefined,
    });
  });

  it.each([
    ["malformed Retry-After", errorResponse(429, { retryAfter: "later" })],
    ["server failure", errorResponse(503)],
  ])("applies bounded retry timing for a %s", async (_label, firstResponse) => {
    vi.useFakeTimers();
    const item = track("bounded-retry");
    const drive = {
      downloadFileMedia: vi
        .fn()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({
      drive,
      clock: {
        now: () => Date.now(),
        sleep: async () => undefined,
        random: () => 0.5,
      },
    });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.manager.start();

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
    });
    const nextAttemptAt =
      realm.useOfflineStore.getState().trackJobs[item.fileId]?.nextAttemptAt;
    expect(nextAttemptAt).toBeTypeOf("number");
    expect(nextAttemptAt).toBeGreaterThan(Date.now());
    expect(nextAttemptAt).toBeLessThanOrEqual(Date.now() + 1_000);

    await vi.advanceTimersByTimeAsync(
      (nextAttemptAt ?? Date.now()) - Date.now() - 1,
    );
    expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledTimes(2);
      expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
        "downloaded",
      );
    });
  });

  it("bounds unknown failures and releases the queue without a hot loop", async () => {
    vi.useFakeTimers();
    const item = track("unknown-failure");
    const drive = {
      downloadFileMedia: vi.fn(async () => {
        throw new Error("unexpected");
      }),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({
      drive,
      clock: {
        now: () => Date.now(),
        sleep: async () => undefined,
        random: () => 0.5,
      },
    });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.manager.start();

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(drive.downloadFileMedia).toHaveBeenCalledTimes(2);
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      attempt: 2,
      errorCategory: "unknown",
      nextAttemptAt: undefined,
    });
  });

  it("does not run an armed retry while the document is hidden", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    const item = track("hidden-retry");
    const drive = {
      downloadFileMedia: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(mediaResponse()),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({
      drive,
      clock: {
        now: () => Date.now(),
        sleep: async () => undefined,
        random: () => 0.5,
      },
    });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.manager.start();
    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
    });

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(drive.downloadFileMedia).toHaveBeenCalledOnce();

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledTimes(2);
    });
  });

  it("stops automatic retry after a quota failure", async () => {
    vi.useFakeTimers();
    const item = track("quota");
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.mocked(realm.dependencies.database.putTrack).mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );

    await realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(realm.dependencies.database.putTrack).toHaveBeenCalledOnce();
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      errorCategory: "storage-full",
    });
  });

  it("does not mark a Blob downloaded when Drive's expected size differs", async () => {
    const item = { ...track("mismatch"), size: "6" };
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);

    await realm.manager.ensureCollectionAvailableOffline("mix");

    expect(realm.dependencies.database.putTrack).not.toHaveBeenCalled();
    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      errorCategory: "integrity",
    });
  });

  it("automatically retries after an IndexedDB scan never settles", async () => {
    vi.useFakeTimers();
    const scan = deferred<{ fileId: string; sizeBytes: number }[]>();
    const realm = await loadTestRealm();
    vi.mocked(realm.dependencies.database.getAllTrackSizes)
      .mockReturnValueOnce(scan.promise)
      .mockResolvedValueOnce([]);

    realm.manager.start();
    await vi.advanceTimersByTimeAsync(15_001);
    await vi.advanceTimersByTimeAsync(1_001);

    expect(realm.dependencies.database.getAllTrackSizes).toHaveBeenCalledTimes(
      2,
    );
  });

  it("automatically recovers when a per-track IndexedDB read never settles", async () => {
    vi.useFakeTimers();
    const item = track("read-timeout");
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    realm.useOfflineStore.getState().enableCollection("mix", [item.fileId]);
    realm.databaseFake.tracks.set(item.fileId, storedTrack(item));
    vi.mocked(realm.dependencies.database.getTrack)
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(storedTrack(item));

    realm.manager.start();
    await vi.advanceTimersByTimeAsync(15_001);
    await vi.advanceTimersByTimeAsync(1_001);

    expect(realm.dependencies.database.getTrack).toHaveBeenCalledTimes(2);
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });

  it("times out a never-settling response body", async () => {
    vi.useFakeTimers();
    const item = track("body-timeout");
    const drive = {
      downloadFileMedia: vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            blob: () => new Promise<Blob>(() => undefined),
          }) as Response,
      ),
      getFileMetadata: vi.fn(async () => metadataResponse(item)),
    };
    const realm = await loadTestRealm({ drive });
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(drive.downloadFileMedia).toHaveBeenCalledOnce();
    });
    await vi.advanceTimersByTimeAsync(120_001);

    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      errorCategory: "timeout",
    });
  });

  it("times out a never-settling IndexedDB write and succeeds on manual retry", async () => {
    vi.useFakeTimers();
    const item = track("write-timeout");
    const realm = await loadTestRealm();
    seedPlaylist(realm.usePlaylistStore, "mix", [item]);
    vi.mocked(realm.dependencies.database.putTrack).mockImplementationOnce(
      () => new Promise<void>(() => undefined),
    );

    void realm.manager.ensureCollectionAvailableOffline("mix");
    await vi.waitFor(() => {
      expect(realm.dependencies.database.putTrack).toHaveBeenCalledOnce();
    });
    await vi.advanceTimersByTimeAsync(15_001);

    expect(
      realm.useOfflineStore.getState().trackJobs[item.fileId],
    ).toMatchObject({
      status: "failed",
      errorCategory: "timeout",
    });

    await realm.manager.retryDownloads("mix");
    expect(realm.dependencies.database.putTrack).toHaveBeenCalledTimes(2);
    expect(realm.useOfflineStore.getState().trackStatus[item.fileId]).toBe(
      "downloaded",
    );
  });
});
