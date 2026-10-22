import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  progress: new Map<string, unknown>(),
  fences: new Map<string, number>(),
  blockOpen: false,
  openGate: Promise.resolve(),
}));
vi.mock("idb", () => ({
  openDB: async () => {
    if (storage.blockOpen) {
      storage.blockOpen = false;
      await storage.openGate;
    }
    return {
      close() {},
      delete: async (_store: string, key: string) =>
        storage.progress.delete(key),
      transaction: () => ({
        done: Promise.resolve(),
        objectStore: (name: string) => {
          const data =
            name === "progress"
              ? storage.progress
              : (storage.fences as Map<string, unknown>);
          return {
            get: async (key: string) => data.get(key),
            put: async (value: unknown, key: string) =>
              data.set(key, structuredClone(value)),
            clear: async () => data.clear(),
          };
        },
      }),
    };
  },
}));

beforeEach(() => {
  storage.progress.clear();
  storage.fences.clear();
  storage.blockOpen = false;
  vi.resetModules();
});

describe("background checkpoint persistence fences", () => {
  it("does not resurrect cleared checkpoints when an earlier save finishes opening the DB after logout", async () => {
    const db = await import("./background-progress-db");
    await db.loadBackgroundProgress("catalog:account:scope");
    let open!: () => void;
    storage.openGate = new Promise((resolve) => {
      open = resolve;
    });
    storage.blockOpen = true;
    const lateWrite = db.saveBackgroundProgress("catalog:account:scope", {
      private: "old generation",
    });
    await db.clearBackgroundProgress();
    open();
    await expect(lateWrite).resolves.toBe(false);
    expect(storage.progress.size).toBe(0);
  });

  it("rejects a previous tab's checkpoint after the persisted logout epoch changes", async () => {
    const db = await import("./background-progress-db");
    await db.loadBackgroundProgress("metadata:account:scope");
    // Another tab advanced the same durable fence.
    storage.fences.set("logout", 1);
    await expect(
      db.saveBackgroundProgress("metadata:account:scope", { cursor: 20 }),
    ).resolves.toBe(false);
    expect(storage.progress.size).toBe(0);
    await db.loadBackgroundProgress("metadata:account:scope");
    await expect(
      db.saveBackgroundProgress("metadata:account:scope", { cursor: 5 }),
    ).resolves.toBe(true);
    expect(storage.progress.get("metadata:account:scope")).toEqual({
      cursor: 5,
    });
  });

  it("rechecks scope after opening storage and deletes completed checkpoints", async () => {
    const db = await import("./background-progress-db");
    let current = true;
    let open!: () => void;
    storage.openGate = new Promise((resolve) => {
      open = resolve;
    });
    storage.blockOpen = true;
    const oldScope = db.saveBackgroundProgress("metadata:account:old", 5, {
      isCurrent: () => current,
    });
    current = false;
    open();
    await expect(oldScope).resolves.toBe(false);
    await db.saveBackgroundProgress("metadata:account:new", 10);
    await db.deleteBackgroundProgress("metadata:account:new");
    expect(storage.progress.size).toBe(0);
  });
  it("fences newly appended chunk keys using their manifest's captured logout epoch", async () => {
    const db = await import("./background-progress-db");
    await db.loadBackgroundProgress("catalog:account:scope");
    storage.fences.set("logout", 1);
    db.inheritBackgroundProgressFence(
      "catalog:account:scope",
      "catalog:account:scope:chunk:1",
    );
    await expect(
      db.saveBackgroundProgress("catalog:account:scope:chunk:1", [
        "private-old-scan",
      ]),
    ).resolves.toBe(false);
    expect(storage.progress.size).toBe(0);
  });
  it("preserves the original logout fence when a catalog manifest is reset during the same flight", async () => {
    const db = await import("./background-progress-db");
    const manifest = "catalog:account:reset";
    await db.loadBackgroundProgress(manifest);
    await db.saveBackgroundProgress(manifest, { pageToken: "expired" });
    await db.deleteBackgroundProgress(manifest, { preserveFence: true });
    storage.fences.set("logout", 1);
    db.inheritBackgroundProgressFence(manifest, `${manifest}:chunk:reset`);
    await expect(
      db.saveBackgroundProgress(`${manifest}:chunk:reset`, ["old flight"]),
    ).resolves.toBe(false);
    await expect(
      db.saveBackgroundProgress(manifest, { pageToken: "new" }),
    ).resolves.toBe(false);
    expect(storage.progress.size).toBe(0);
  });
});
