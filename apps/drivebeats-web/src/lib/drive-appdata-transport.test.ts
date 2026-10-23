// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { APPDATA_MAX_FILE_BYTES } from "@/lib/drive-appdata-schema";
import { createDriveAppDataTransport } from "@/lib/drive-appdata-transport";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
describe("hidden Drive transport", () => {
  it("reads a durable coordinator ID with one media request while arbitrary reads retain membership checks", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("saved"));
    const transport = createDriveAppDataTransport("test-token", request);
    expect(await transport.readKnown?.("known")).toBe("saved");
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain("?alt=media");
  });
  it("follows partial pages and never treats an incomplete listing as authoritative", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ files: [], nextPageToken: "next" }))
      .mockResolvedValueOnce(json({ files: [{ id: "saved", size: "42" }] }));
    const transport = createDriveAppDataTransport("test-token", request);
    expect(await transport.list()).toEqual([{ id: "saved", size: 42 }]);
    const urls = request.mock.calls.map(([url]) => new URL(String(url)));
    expect(
      urls.every((url) => url.searchParams.get("spaces") === "appDataFolder"),
    ).toBe(true);
    expect(urls[1].searchParams.get("pageToken")).toBe("next");
    request.mockResolvedValueOnce(json({ files: [], incompleteSearch: true }));
    await expect(transport.list()).rejects.toThrow(
      "appdata_incomplete_listing",
    );
  });

  it("never deletes a music file even if a caller supplies its ID", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ id: "music", spaces: ["drive"] }));
    await expect(
      createDriveAppDataTransport("test-token", request).delete("music"),
    ).rejects.toThrow("appdata_not_hidden");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).toBeUndefined();
  });

  it("creates only hidden JSON and verifies a lost-response retry without a second file", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({ id: "known", spaces: ["appDataFolder"] }))
      .mockResolvedValueOnce(new Response('{"saved":true}'));
    const transport = createDriveAppDataTransport("test-token", request);
    await transport.create("known", '{"saved":true}');
    const post = request.mock.calls[0];
    expect(String(post[0])).toContain("uploadType=multipart");
    expect(post[1]?.body).toContain('"parents":["appDataFolder"]');
    expect(post[1]?.body).toContain('"id":"known"');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not acknowledge duplicate IDs containing different data", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({ id: "known", spaces: ["appDataFolder"] }))
      .mockResolvedValueOnce(new Response("other"));
    await expect(
      createDriveAppDataTransport("test-token", request).create(
        "known",
        "expected",
      ),
    ).rejects.toThrow("appdata_upload_verification_failed");
  });

  it("bounds streaming reads even when content-length is absent", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "known", spaces: ["appDataFolder"] }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(APPDATA_MAX_FILE_BYTES + 1)),
      );
    await expect(
      createDriveAppDataTransport("test-token", request).read("known"),
    ).rejects.toThrow("appdata_file_too_large");
  });

  it("distinguishes quota/access rejection and network uncertainty without exposing provider text", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("private provider message", { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response("private provider message", { status: 403 }),
      )
      .mockRejectedValueOnce(new Error("private network details"));
    const transport = createDriveAppDataTransport("test-token", request);
    await expect(transport.generateId()).rejects.toThrow(
      "appdata_rate_limited",
    );
    await expect(transport.generateId()).rejects.toThrow(
      "appdata_access_required",
    );
    await expect(transport.generateId()).rejects.toThrow(
      "appdata_provider_uncertain",
    );
  });

  it("reports full storage separately from missing approval", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403),
      );
    await expect(
      createDriveAppDataTransport("test-token", request).generateId(),
    ).rejects.toThrow("appdata_storage_full");
  });
});
