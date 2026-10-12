import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateIncrementalDownloadBytes,
  requestStoragePersistence,
} from "@/lib/storage-persistence";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage persistence", () => {
  it("reports granted when storage is already persistent", async () => {
    const persist = vi.fn();
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn(async () => true),
        persist,
      },
    });

    await expect(requestStoragePersistence()).resolves.toBe("granted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports the actual result of a persistence request", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => false),
      },
    });

    await expect(requestStoragePersistence()).resolves.toBe("not-granted");
  });

  it("reports unsupported without inferring success", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestStoragePersistence()).resolves.toBe("unsupported");
  });

  it("counts only bytes that are not already stored or shared", () => {
    expect(
      calculateIncrementalDownloadBytes(
        [
          { fileId: "stored", size: "10" },
          { fileId: "shared", size: "20" },
          { fileId: "new", size: "30" },
        ],
        new Set(["stored"]),
        new Set(["shared"]),
      ),
    ).toBe(30);
  });
});
