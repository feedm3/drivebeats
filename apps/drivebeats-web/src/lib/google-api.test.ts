import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Drive read transport", () => {
  it("never falls back to a relative browser route for server-side reads", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { listGoogleDriveFiles } = await import("./google-api");
    await expect(
      listGoogleDriveFiles("token", new URLSearchParams()),
    ).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("relays a failed cross-origin read without putting credentials in the URL and reuses that transport for audio", async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(new Response("audio"));
    vi.stubGlobal("fetch", fetchMock);
    const { listGoogleDriveFiles, downloadGoogleDriveFileMedia } = await import(
      "./google-api"
    );

    const params = new URLSearchParams({
      q: "trashed = false",
      pageSize: "1000",
    });
    expect((await listGoogleDriveFiles("private-token", params)).ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/drive/read?${params}`);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer private-token" },
    });
    expect(fetchMock.mock.calls[1][0]).not.toContain("private-token");

    expect(
      await (
        await downloadGoogleDriveFileMedia("selected-track", "private-token")
      ).text(),
    ).toBe("audio");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const audioUrl = new URL(
      fetchMock.mock.calls[2][0],
      "https://drivebeats.test",
    );
    expect(audioUrl.pathname).toBe("/api/drive/read");
    expect(audioUrl.searchParams.get("fileId")).toBe("selected-track");
    expect(audioUrl.searchParams.get("alt")).toBe("media");
  });

  it("does not retry a cancelled read or a rejected Drive permission response", async () => {
    vi.resetModules();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { listGoogleDriveFiles } = await import("./google-api");
    await expect(
      listGoogleDriveFiles(
        "private-token",
        new URLSearchParams(),
        controller.signal,
      ),
    ).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock
      .mockReset()
      .mockResolvedValue(new Response("Denied", { status: 403 }));
    expect(
      (await listGoogleDriveFiles("private-token", new URLSearchParams()))
        .status,
    ).toBe(403);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps direct reads after an offline failure or an unsuccessful relay", async () => {
    vi.resetModules();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 502 }))
      .mockResolvedValueOnce(Response.json({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listGoogleDriveFiles } = await import("./google-api");
    const params = new URLSearchParams();
    await expect(listGoogleDriveFiles("token", params)).rejects.toThrow(
      "Failed to fetch",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await listGoogleDriveFiles("token", params);
    expect((await listGoogleDriveFiles("token", params)).status).toBe(502);
    await listGoogleDriveFiles("token", params);
    expect(fetchMock.mock.calls[4][0]).toBe(
      "https://www.googleapis.com/drive/v3/files?",
    );
  });

  it("rechecks direct access after five minutes and preserves abort signals on active relay reads", async () => {
    vi.resetModules();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"))
      .mockResolvedValueOnce(Response.json({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listGoogleDriveFiles } = await import("./google-api");
    await listGoogleDriveFiles("token", new URLSearchParams());
    const controller = new AbortController();
    controller.abort();
    await expect(
      listGoogleDriveFiles("token", new URLSearchParams(), controller.signal),
    ).rejects.toThrow("Cancelled");
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/drive/read?",
      expect.objectContaining({ signal: controller.signal }),
    ]);
    now.mockReturnValue(1000 + 5 * 60 * 1000);
    await listGoogleDriveFiles("token", new URLSearchParams());
    expect(fetchMock.mock.calls[3][0]).toBe(
      "https://www.googleapis.com/drive/v3/files?",
    );
  });
});
