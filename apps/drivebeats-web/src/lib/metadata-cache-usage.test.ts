import { describe, expect, it, vi } from "vitest";
import type { MetadataRecord } from "@/lib/metadata-cache-types";
import { getMetadataCacheUsage } from "@/lib/metadata-cache-usage";

const scan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/metadata-cache-db", () => ({ scanMetadataRecords: scan }));

describe("metadata cache storage estimate", () => {
  it("streams only the requested account and counts UTF-8 payloads without retaining rows", async () => {
    const rows = [
      { accountId: "synthetic", fileId: "one", tags: { title: "Björk 🎶" } },
      { accountId: "synthetic", fileId: "two", status: "unresolved" },
    ] as MetadataRecord[];
    const controller = new AbortController();
    scan.mockImplementationOnce(async (account, visit, signal) => {
      expect(account).toBe("synthetic");
      expect(signal).toBe(controller.signal);
      for (const row of rows) visit(row);
      return true;
    });
    const usage = await getMetadataCacheUsage("synthetic", controller.signal);
    expect(usage?.recordCount).toBe(2);
    expect(usage?.approximateBytes).toBe(
      rows.reduce(
        (total, row) => total + new Blob([JSON.stringify(row)]).size,
        0,
      ),
    );
  });

  it("reports unavailable rather than an empty cache after a failed scan", async () => {
    scan.mockResolvedValueOnce(false);
    expect(await getMetadataCacheUsage("synthetic")).toBeNull();
  });

  it("preserves cancellation so a closed dialog can abandon the cursor", async () => {
    const controller = new AbortController();
    controller.abort();
    scan.mockImplementationOnce(async (_account, _visit, signal) => {
      signal.throwIfAborted();
    });
    await expect(
      getMetadataCacheUsage("synthetic", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
