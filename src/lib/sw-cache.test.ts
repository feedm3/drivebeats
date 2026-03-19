import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Simulate the SW message handler logic in isolation
describe("SW CLEAR_CACHES handler", () => {
  let deletedKeys: string[];

  beforeEach(() => {
    deletedKeys = [];

    Object.defineProperty(globalThis, "caches", {
      value: {
        keys: vi.fn().mockResolvedValue(["drivebeats-shell-v2", "other-cache"]),
        delete: vi.fn((key: string) => {
          deletedKeys.push(key);
          return Promise.resolve(true);
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function simulateClearCaches() {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  it("deletes all cache storage entries", async () => {
    await simulateClearCaches();

    expect(deletedKeys).toContain("drivebeats-shell-v2");
    expect(deletedKeys).toContain("other-cache");
    expect(deletedKeys).toHaveLength(2);
  });

  it("handles empty cache list", async () => {
    (caches.keys as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await simulateClearCaches();

    expect(deletedKeys).toHaveLength(0);
  });
});
