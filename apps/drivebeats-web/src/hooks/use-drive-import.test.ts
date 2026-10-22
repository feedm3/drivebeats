import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPickedFileMetadata } from "./use-drive-import";

afterEach(() => vi.unstubAllGlobals());

describe("Drive Picker metadata batches through the shared scheduler", () => {
  it("reads more than the queue limit without losing selected tracks or their order", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `picked-${i}`);
    const fetch = vi.fn(async (input: string) => {
      const id = new URL(input).pathname.split("/").at(-1);
      return Response.json({ id, name: `${id}.mp3`, mimeType: "audio/mpeg" });
    });
    vi.stubGlobal("fetch", fetch);
    const files = await fetchPickedFileMetadata(ids, "synthetic-test-token");
    expect(files.map((file) => file.id)).toEqual(ids);
    expect(fetch).toHaveBeenCalledTimes(150);
  });

  it("stops feeding the lane when a lookup fails", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPickedFileMetadata(
        Array.from({ length: 150 }, (_, i) => `picked-${i}`),
        "synthetic-test-token",
      ),
    ).rejects.toThrow("Drive metadata lookup failed");
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("starts no work for a cancelled selection", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchPickedFileMetadata(["picked"], "synthetic-test-token", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
