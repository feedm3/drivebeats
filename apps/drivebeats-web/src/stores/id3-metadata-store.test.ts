import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataRecord } from "@/lib/metadata-cache-types";

const mocks = vi.hoisted(() => ({
  records: new Map<string, MetadataRecord>(),
  extract: vi.fn(),
  auth: { authStatus: "authenticated", user: { id: "a" }, isLoggingOut: false },
  clear: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => mocks.auth, subscribe: vi.fn() },
}));
vi.mock("@/lib/id3-metadata", () => ({
  extractId3MetadataResult: mocks.extract,
}));
vi.mock("@/lib/metadata-cache-db", () => ({
  loadMetadataCache: async (accountId: string) => ({
    records: [...mocks.records.values()].filter(
      (record) => record.accountId === accountId,
    ),
    epoch: 0,
    durable: true,
  }),
  loadMetadataRecord: mocks.read,
  saveMetadataRecord: async (record: MetadataRecord) => {
    mocks.save(record);
    mocks.records.set(
      `${record.accountId}:${record.fileId}`,
      structuredClone(record),
    );
    return true;
  },
  clearMetadataCache: async (accountId: string) => {
    if ((await mocks.clear()) === false) return false;
    for (const [key, record] of mocks.records)
      if (record.accountId === accountId) mocks.records.delete(key);
    return true;
  },
}));
const descriptor = {
  id: "track",
  modifiedTime: "2026-10-22",
  size: "100",
  name: "track.mp3",
  mimeType: "audio/mpeg",
};
async function load() {
  vi.resetModules();
  const { useId3MetadataStore } = await import("./id3-metadata-store");
  return useId3MetadataStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.records.clear();
  mocks.clear.mockResolvedValue(undefined);
  mocks.auth.user.id = "a";
  mocks.read.mockImplementation(async (accountId: string, fileId: string) => ({
    record: mocks.records.get(`${accountId}:${fileId}`),
    epoch: 0,
  }));
});

describe("browser-local tag lifecycle", () => {
  it("reports failure when durable cache deletion fails while still fencing old writes", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "ready",
      tags: { title: "Retained after failed removal" },
      loadedVia: "local_blob",
    });
    const original = store.getState().records.track;
    localStorage.removeItem("drivebeats-metadata-cache-reset");
    const generation = store.getState().generation;
    mocks.clear.mockResolvedValue(false);
    await expect(store.getState().resetCachedMetadata()).rejects.toThrow(
      "could not be removed",
    );
    expect(store.getState().accountId).toBe("a");
    expect(store.getState().generation).toBeGreaterThan(generation);
    expect(store.getState()).toMatchObject({ hydrated: true, durable: true });
    expect(store.getState().records.track).toEqual(original);
    expect(localStorage.getItem("drivebeats-metadata-cache-reset")).toBeNull();
  });
  it("resets cached metadata without signing out and fences writes from before the reset", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "ready",
      tags: { title: "Before reset" },
      loadedVia: "local_blob",
    });
    const generation = store.getState().generation;
    await store.getState().resetCachedMetadata();
    expect(store.getState()).toMatchObject({
      accountId: "a",
      hydrated: true,
      records: {},
      cache: {},
    });
    expect(store.getState().generation).toBeGreaterThan(generation);
    expect(mocks.records.size).toBe(0);
    expect(localStorage.getItem("drivebeats-metadata-local-account")).toBe("a");
    expect(
      await store.getState().putRecord(
        descriptor,
        {
          status: "ready",
          tags: { title: "Late old write" },
          loadedVia: "local_blob",
        },
        generation,
      ),
    ).toBe(false);
    expect(
      await store.getState().putRecord(descriptor, {
        status: "ready",
        tags: { title: "Fresh after reset" },
        loadedVia: "local_blob",
      }),
    ).toBe(true);
    expect(store.getState().records.track.tags?.title).toBe(
      "Fresh after reset",
    );
  });
  it("adopts a peer cache reset without clearing the shared database a second time", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "ready",
      tags: { title: "Before peer reset" },
      loadedVia: "local_blob",
    });
    const generation = store.getState().generation;
    mocks.records.clear();
    await store.getState().resetCachedMetadata(false);
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      accountId: "a",
      hydrated: true,
      records: {},
    });
    expect(store.getState().generation).toBeGreaterThan(generation);
  });
  it("discards legacy unscoped storage on initialization without reading its tags", async () => {
    localStorage.setItem("drivebeats-id3-metadata", "legacy untrusted data");
    const store = await load();
    expect(localStorage.getItem("drivebeats-id3-metadata")).toBeNull();
    expect(store.getState().records).toEqual({});
  });
  it("initializes safely when legacy storage cleanup is blocked", async () => {
    const remove = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
    try {
      await expect(load()).resolves.toBeDefined();
      expect(remove).toHaveBeenCalledWith("drivebeats-id3-metadata");
    } finally {
      remove.mockRestore();
    }
  });
  it("retains a requested old durable record at the memory limit without changing its checked time", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "ready",
      tags: { title: "Old cached title" },
      loadedVia: "local_blob",
    });
    const original = { ...store.getState().records.track, checkedAt: 1 };
    mocks.records.clear();
    for (let index = 0; index < 20_000; index++) {
      const fileId = `resident-${index}`;
      mocks.records.set(`a:${fileId}`, {
        ...original,
        fileId,
        checkedAt: index + 2,
      });
    }
    const reopened = await load();
    await reopened.getState().setAccount("a");
    mocks.records.set("a:track", original);
    await reopened.getState().loadRecord(descriptor);
    expect(reopened.getState().records.track).toEqual(original);
    expect(Object.keys(reopened.getState().records)).toHaveLength(20_000);
    expect(Object.keys(reopened.getState().cache)).toHaveLength(20_000);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const { retainCachedMetadataRecord } = await import("./id3-metadata-store");
    const release = retainCachedMetadataRecord("resident-1");
    await reopened.getState().putRecord(
      { ...descriptor, id: "background-new" },
      {
        status: "no_target_tags",
        loadedVia: "drive_range",
      },
    );
    expect(reopened.getState().records["resident-1"]).toBeDefined();
    expect(reopened.getState().records["resident-2"]).toBeUndefined();
    expect(Object.keys(reopened.getState().records)).toHaveLength(20_000);
    release();
    await reopened.getState().putRecord(
      { ...descriptor, id: "background-next" },
      {
        status: "no_target_tags",
        loadedVia: "drive_range",
      },
    );
    expect(reopened.getState().records["resident-1"]).toBeUndefined();
  });
  it("does not publish a durable read after its membership proof becomes invalid", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "ready",
      tags: { title: "Cached" },
      loadedVia: "local_blob",
    });
    const record = store.getState().records.track;
    store.setState({ records: {}, cache: {} });
    let release!: (value: { record: MetadataRecord; epoch: number }) => void;
    mocks.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let valid = true;
    const pending = store
      .getState()
      .loadRecord(descriptor, undefined, () => valid);
    valid = false;
    release({ record, epoch: 0 });
    await pending;
    expect(store.getState().records).toEqual({});
  });
  it("retains confirmed empty and terminal outcomes across reload with version and environment invalidation", async () => {
    const first = await load();
    await first.getState().setAccount("a");
    await first.getState().putRecord(descriptor, {
      status: "no_target_tags",
      loadedVia: "drive_range",
    });
    await first.getState().putRecord(
      { ...descriptor, id: "blocked" },
      {
        status: "unresolved",
        reason: "range_unsupported",
        environmentKey: "host-v1",
        loadedVia: "drive_range",
      },
    );

    const reopened = await load();
    await reopened.getState().setAccount("a");
    expect(reopened.getState().getRecord(descriptor)).toMatchObject({
      freshness: "current",
      record: { status: "no_target_tags" },
    });
    expect(
      reopened
        .getState()
        .getRecord({ ...descriptor, id: "blocked" }, "host-v1"),
    ).toMatchObject({ freshness: "current", record: { status: "unresolved" } });
    expect(
      reopened.getState().getRecord({ ...descriptor, id: "blocked" }, "host-v2")
        .freshness,
    ).toBe("stale");
    expect(
      reopened.getState().getRecord({ ...descriptor, size: "101" }).freshness,
    ).toBe("stale");
    expect(reopened.getState().getRecord({ id: "track" }).freshness).toBe(
      "unknown",
    );
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("does not reuse outcomes from a previous parser or policy", async () => {
    const first = await load();
    await first.getState().setAccount("a");
    await first.getState().putRecord(descriptor, {
      status: "ready",
      tags: { artist: "Artist" },
      loadedVia: "local_blob",
    });
    const record = mocks.records.get("a:track");
    if (!record) throw new Error("fixture was not persisted");
    record.policyVersion -= 1;
    const reopened = await load();
    await reopened.getState().setAccount("a");
    expect(reopened.getState().getRecord(descriptor).freshness).toBe("stale");
    expect(reopened.getState().cache).toEqual({});
  });

  it("fences extraction that completes after logout and awaits an already-started durable wipe", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    const generation = store.getState().generation;
    let finish!: (value: unknown) => void;
    const extraction = new Promise((resolve) => {
      finish = resolve;
    });
    const pending = extraction.then((result) =>
      store
        .getState()
        .putRecord(
          descriptor,
          result as Parameters<
            ReturnType<typeof store.getState>["putRecord"]
          >[1],
          generation,
        ),
    );
    let finishClear!: () => void;
    mocks.clear.mockReturnValue(
      new Promise<void>((resolve) => {
        finishClear = resolve;
      }),
    );
    const logout = store.getState().setAccount(null);
    let cleared = false;
    const wipe = store
      .getState()
      .clearAll()
      .then(() => {
        cleared = true;
      });
    await Promise.resolve();
    expect(cleared).toBe(false);
    finish({
      status: "ready",
      tags: { title: "Private title" },
      loadedVia: "local_blob",
    });
    await pending;
    finishClear();
    await Promise.all([logout, wipe]);
    expect(store.getState().records).toEqual({});
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects an older file-version result that finishes after the current version", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    const generation = store.getState().generation;
    store.getState().observeDescriptor(descriptor);
    const updated = { ...descriptor, modifiedTime: "2026-10-23" };
    store.getState().observeDescriptor(updated);
    // A cache-only render of an older descriptor cannot regress a live job.
    store.getState().getRecord(descriptor);
    await store
      .getState()
      .putRecord(
        updated,
        { status: "ready", tags: { title: "New" }, loadedVia: "drive_range" },
        generation,
      );
    await expect(
      store
        .getState()
        .putRecord(
          descriptor,
          { status: "ready", tags: { title: "Old" }, loadedVia: "drive_range" },
          generation,
        ),
    ).resolves.toBe(false);
    expect(store.getState().cache.track?.title).toBe("New");
  });

  it("never exposes account A to account B", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "ready",
      tags: { title: "Private" },
      loadedVia: "local_blob",
    });
    expect(store.getState().cache.track?.title).toBe("Private");
    const oldGeneration = store.getState().generation;
    await store.getState().setAccount("b");
    expect(store.getState().cache).toEqual({});
    await expect(
      store.getState().putRecord(
        descriptor,
        {
          status: "ready",
          tags: { title: "Late A" },
          loadedVia: "local_blob",
        },
        oldGeneration,
      ),
    ).resolves.toBe(false);
    expect([...mocks.records.values()]).toEqual([]);
  });
  it("checks an evicted durable outcome without hydrating or evicting the memory facade", async () => {
    const store = await load();
    await store.getState().setAccount("a");
    await store.getState().putRecord(descriptor, {
      status: "no_target_tags",
      loadedVia: "drive_range",
    });
    store.setState({ records: {}, cache: {} });
    const snapshot = store.getState().records;
    expect(await store.getState().peekRecord(descriptor)).toMatchObject({
      freshness: "current",
      record: { status: "no_target_tags" },
    });
    expect(store.getState().records).toBe(snapshot);
    expect(store.getState().cache).toEqual({});
  });
});
