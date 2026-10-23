import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("idb", () => ({ openDB: mocks.open }));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("reports a blocked upgrade, closes its late connection and permits a later retry", async () => {
  let finish!: (db: unknown) => void;
  mocks.open.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { readPortableCache } = await import("./metadata-cache-db");
  const opening = readPortableCache("a");
  const failed = expect(opening).rejects.toThrow("close_other_tabs");
  await vi.advanceTimersByTimeAsync(15_000);
  await failed;
  const old = { close: vi.fn() };
  finish(old);
  await Promise.resolve();
  expect(old.close).toHaveBeenCalledOnce();
  const getAllFromIndex = vi.fn(async () => []);
  mocks.open.mockResolvedValueOnce({ getAllFromIndex, close: vi.fn() });
  expect(await readPortableCache("a")).toEqual([]);
  expect(getAllFromIndex).toHaveBeenCalledWith("portable", "account", "a");
});
