import { describe, expect, it, vi } from "vitest";
import { createOfflineDatabase } from "@/lib/offline-db";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("offline database connection recovery", () => {
  it("reopens after the browser terminates the memoized connection", async () => {
    const callbacks: Array<{ terminated?: () => void }> = [];
    const databases = [
      {
        transaction: vi.fn(() => ({
          objectStore: () => ({ get: () => Promise.resolve(undefined) }),
          done: Promise.resolve(),
        })),
        close: vi.fn(),
      },
      {
        transaction: vi.fn(() => ({
          objectStore: () => ({ get: () => Promise.resolve(undefined) }),
          done: Promise.resolve(),
        })),
        close: vi.fn(),
      },
    ];
    const openDatabase = vi.fn(async (_name, _version, options) => {
      callbacks.push(options);
      return databases[callbacks.length - 1];
    });
    const database = createOfflineDatabase({
      openDatabase: openDatabase as unknown as Parameters<
        typeof createOfflineDatabase
      >[0]["openDatabase"],
    });

    await database.getTrack("first");
    callbacks[0].terminated?.();
    await database.getTrack("second");

    expect(openDatabase).toHaveBeenCalledTimes(2);
  });

  it("does not resolve a write before its transaction commits", async () => {
    const transactionDone = deferred<void>();
    const put = vi.fn().mockResolvedValue(undefined);
    const database = createOfflineDatabase({
      openDatabase: vi.fn(async () => ({
        transaction: () => ({
          objectStore: () => ({ put }),
          done: transactionDone.promise,
        }),
        close: vi.fn(),
      })) as unknown as Parameters<
        typeof createOfflineDatabase
      >[0]["openDatabase"],
    });
    let settled = false;

    const write = database
      .putTrack("track", {
        blob: new Blob(["audio"]),
        sizeBytes: 5,
        mimeType: "audio/mpeg",
        name: "redacted-in-diagnostics.mp3",
        modifiedTime: "today",
        downloadedAt: 1,
      })
      .then(() => {
        settled = true;
      });

    await Promise.resolve();
    await Promise.resolve();
    expect(put).toHaveBeenCalled();
    expect(settled).toBe(false);

    transactionDone.resolve();
    await write;
    expect(settled).toBe(true);
  });
});
