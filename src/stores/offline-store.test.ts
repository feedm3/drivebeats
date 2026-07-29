import { beforeEach, describe, expect, it } from "vitest";
import { migrateOfflineState, useOfflineStore } from "@/stores/offline-store";

describe("offline state migration", () => {
  it("preserves old collections and normalizes active statuses to queued jobs", () => {
    const migrated = migrateOfflineState(
      {
        collections: {
          favorites: {
            enabled: true,
            trackFileIds: ["one", "two", "three"],
            totalBytes: 0,
            downloadedCount: 1,
            totalCount: 3,
          },
        },
        trackStatus: {
          one: "downloaded",
          two: "downloading",
          three: "updating",
        },
        refCounts: { one: 99 },
      },
      0,
    );

    expect(migrated.collections).toEqual({
      favorites: {
        enabled: true,
        trackFileIds: ["one", "two", "three"],
        totalBytes: 0,
        downloadedCount: 1,
        totalCount: 3,
      },
    });
    expect(migrated.refCounts).toEqual({ one: 1, two: 1, three: 1 });
    expect(migrated.trackJobs).toMatchObject({
      one: { status: "downloaded", phase: "idle", attempt: 0 },
      two: { status: "queued", phase: "idle", attempt: 0 },
      three: { status: "queued", phase: "idle", attempt: 0 },
    });
  });

  it("rebuilds shared reference counts from valid collection membership", () => {
    const migrated = migrateOfflineState(
      {
        collections: {
          first: {
            enabled: true,
            trackFileIds: ["shared", "only-first"],
            totalBytes: 5,
            downloadedCount: 2,
            totalCount: 2,
          },
          second: {
            enabled: true,
            trackFileIds: ["shared"],
            totalBytes: 5,
            downloadedCount: 1,
            totalCount: 1,
          },
          corrupt: null,
        },
        trackStatus: { shared: "failed" },
        refCounts: {},
      },
      0,
    );

    expect(migrated.refCounts).toEqual({
      shared: 2,
      "only-first": 1,
    });
    expect(migrated.collections).not.toHaveProperty("corrupt");
  });

  it("preserves retry timing until a manual retry clears it", () => {
    const migrated = migrateOfflineState(
      {
        collections: {
          favorites: {
            enabled: true,
            trackFileIds: ["retry-me"],
            totalBytes: 0,
            downloadedCount: 0,
            totalCount: 1,
          },
        },
        trackJobs: {
          "retry-me": {
            status: "failed",
            phase: "idle",
            attempt: 2,
            errorCategory: "network",
            nextAttemptAt: 123_456,
          },
        },
      },
      1,
    );

    useOfflineStore.setState(migrated);
    expect(useOfflineStore.getState().trackJobs["retry-me"].nextAttemptAt).toBe(
      123_456,
    );

    useOfflineStore.getState().resetRetryableJobs(["retry-me"]);
    expect(useOfflineStore.getState().trackJobs["retry-me"]).toEqual({
      status: "queued",
      phase: "idle",
      attempt: 0,
    });
  });
});

describe("offline store invariants", () => {
  beforeEach(() => {
    useOfflineStore.getState().clearAll();
  });

  it("enabling the same collection twice does not inflate reference counts", () => {
    const store = useOfflineStore.getState();

    store.enableCollection("favorites", ["one", "two"]);
    store.enableCollection("favorites", ["one", "two"]);

    expect(useOfflineStore.getState().refCounts).toEqual({ one: 1, two: 1 });
  });

  it("keeps a shared job until the last collection is disabled", () => {
    const store = useOfflineStore.getState();
    store.enableCollection("first", ["shared"]);
    store.enableCollection("second", ["shared"]);

    useOfflineStore.getState().disableCollection("first");
    expect(useOfflineStore.getState().refCounts.shared).toBe(1);
    expect(useOfflineStore.getState().trackJobs.shared).toBeDefined();

    useOfflineStore.getState().disableCollection("second");
    expect(useOfflineStore.getState().refCounts.shared).toBeUndefined();
    expect(useOfflineStore.getState().trackJobs.shared).toBeUndefined();
  });
});
