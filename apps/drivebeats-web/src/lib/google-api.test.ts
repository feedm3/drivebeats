import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import {
  downloadGoogleDriveFileMedia,
  listGoogleDriveFiles,
  readGoogleDriveFileRange,
} from "./google-api";

let accountSequence = 0;
beforeEach(() => {
  vi.useFakeTimers();
  useAuthStore.setState({
    user: {
      id: `google-read-test-${++accountSequence}`,
      email: "test@example.com",
      name: "Test",
      picture: null,
    },
  });
});
afterEach(() => {
  useAuthStore.setState({ isLoggingOut: true });
  useAuthStore.setState({ isLoggingOut: false });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser-only Drive reads", () => {
  it.each([
    { status: 429, marked: true },
    { status: 429, marked: false },
    { status: 503, marked: false },
  ])(
    "does not let Range proxy throttling ($status, marked=$marked) stop direct browser-token playback and folder reads",
    async ({ status, marked }) => {
      const accountId = useAuthStore.getState().user?.id;
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status,
            headers: {
              ...(marked ? { "X-DriveBeats-Cooldown-Scope": "metadata" } : {}),
              "Retry-After": "600",
            },
          }),
        )
        .mockResolvedValueOnce(new Response("audio"))
        .mockResolvedValueOnce(Response.json({ files: [] }));
      vi.stubGlobal("fetch", fetchMock);
      expect(
        (
          await readGoogleDriveFileRange(
            "known",
            "browser-token",
            0,
            15,
            undefined,
            { accountId, fileSize: 1000 },
          )
        ).status,
      ).toBe(status);
      expect(
        await (
          await downloadGoogleDriveFileMedia("known", "browser-token")
        ).text(),
      ).toBe("audio");
      expect(
        await (
          await listGoogleDriveFiles("browser-token", new URLSearchParams())
        ).json(),
      ).toEqual({ files: [] });
      await expect(
        readGoogleDriveFileRange("known", "browser-token", 0, 15, undefined, {
          accountId,
          fileSize: 1000,
        }),
      ).rejects.toMatchObject({
        reason: "rate_limited",
        cooldownScope: "metadata",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/drive-range");
      expect(String(fetchMock.mock.calls[1][0])).toContain(
        "googleapis.com/drive/v3/files/known",
      );
      expect(String(fetchMock.mock.calls[2][0])).toContain(
        "googleapis.com/drive/v3/files?",
      );
    },
  );

  it("retries temporary network failures at the Google endpoint with bounded backoff", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = listGoogleDriveFiles(
      "private-token",
      new URLSearchParams({ pageSize: "1000" }),
    );
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect((await pending).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe(
        "https://www.googleapis.com/drive/v3/files?pageSize=1000",
      );
      expect(String(url)).not.toContain("private-token");
      expect(options?.headers).toEqual({
        Authorization: "Bearer private-token",
      });
    }
  });

  it("stops after three network attempts and never falls back to an app server", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = expect(
      listGoogleDriveFiles("token", new URLSearchParams()),
    ).rejects.toThrow("Failed to fetch");
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.every(([url]) =>
        String(url).startsWith("https://www.googleapis.com/drive/v3/files"),
      ),
    ).toBe(true);
  });

  it.each([401, 403])(
    "does not retry Google permission response %s",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("Denied", { status }));
      vi.stubGlobal("fetch", fetchMock);
      expect(
        (await listGoogleDriveFiles("token", new URLSearchParams())).status,
      ).toBe(status);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("cancels a queued retry immediately without issuing another request", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = expect(
      listGoogleDriveFiles("token", new URLSearchParams(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry when offline or when the browser reports cancellation", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      listGoogleDriveFiles("token", new URLSearchParams()),
    ).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    fetchMock
      .mockReset()
      .mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    await expect(
      listGoogleDriveFiles("token", new URLSearchParams()),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a temporary upstream failure while keeping selected audio downloads direct", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response("audio", { headers: { "Content-Type": "audio/mpeg" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    // Consume the successful response as soon as it arrives. Advancing every
    // timer before reading its body deliberately leaves the transfer idle until
    // the navigation deadline, rather than simulating a download consumer.
    const pending = downloadGoogleDriveFileMedia(
      "selected-track",
      "token",
    ).then((response) => response.text());
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("audio");
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://www.googleapis.com/drive/v3/files/selected-track?alt=media&supportsAllDrives=true",
    );
  });

  it("does not shorten Google's long rate-limit delay", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("Wait", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await listGoogleDriveFiles("token", new URLSearchParams())).status,
    ).toBe(429);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("honors a short Retry-After before retrying", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("Wait", { status: 503, headers: { "Retry-After": "1" } }),
      )
      .mockResolvedValueOnce(Response.json({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = listGoogleDriveFiles("token", new URLSearchParams());
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the final temporary HTTP failure after three attempts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response("Unavailable", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const pending = listGoogleDriveFiles("token", new URLSearchParams());
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("still retries when disposal of an unused failed response rejects", async () => {
    const failedBody = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("Connection lost"));
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(failedBody, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ files: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = listGoogleDriveFiles("token", new URLSearchParams());
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
