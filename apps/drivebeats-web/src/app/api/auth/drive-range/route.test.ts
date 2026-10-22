import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/drive-range/route";
import { serializeAuthSession } from "@/lib/auth-session";
import { GOOGLE_DRIVE_SCOPE } from "@/lib/google";

const file = {
  accountId: "account",
  fileId: "known_track",
  start: 0,
  end: 15,
  size: 4096,
};
let mockFetch: ReturnType<typeof vi.fn>;
function request(
  body: unknown = file,
  options: {
    origin?: string | null;
    fetchSite?: string;
    authenticated?: boolean;
    scopes?: string[];
    signal?: AbortSignal;
  } = {},
) {
  const session = serializeAuthSession({
    user: {
      id: "account",
      email: "test@example.test",
      name: null,
      picture: null,
    },
    grantedScopes: options.scopes ?? [GOOGLE_DRIVE_SCOPE],
  });
  return new NextRequest("https://drivebeats.test/api/auth/drive-range", {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...(options.origin !== null
        ? { Origin: options.origin ?? "https://drivebeats.test" }
        : {}),
      "Sec-Fetch-Site": options.fetchSite ?? "same-origin",
      ...(options.authenticated !== false
        ? {
            cookie: `auth_session=${session}; refresh_token=opaque-test-refresh`,
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
}
function mediaResponse(bytes = new Uint8Array(16)) {
  return new Response(bytes, {
    status: 206,
    headers: { "Content-Range": "bytes 0-15/4096", "Content-Length": "16" },
  });
}
function providerSequence(media: Response = mediaResponse(), sub = "account") {
  mockFetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "opaque-test-access",
          scope: GOOGLE_DRIVE_SCOPE,
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ sub })))
    .mockResolvedValueOnce(media);
}
beforeEach(() => {
  vi.stubEnv("AUTH_SESSION_SECRET", "unit-test-auth-secret");
  vi.stubEnv("GOOGLE_CLIENT_ID", "unit-test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "unit-test-secret");
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authenticated same-origin bounded metadata range", () => {
  it.each([{ authenticated: false }, { scopes: [] }])(
    "rejects unavailable auth before any provider read: %o",
    async (options) => {
      expect((await POST(request(file, options))).status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { origin: "https://foreign.test" },
    { origin: null },
    { fetchSite: "same-site" },
    { fetchSite: "cross-site" },
  ])("rejects CSRF origins: %o", async (options) => {
    expect((await POST(request(file, options))).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("rejects a non-JSON content type before reading credentials or media", async () => {
    const input = request();
    input.headers.set("Content-Type", "text/plain");
    expect((await POST(input)).status).toBe(415);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("requires the refresh cookie even when the signed session is present", async () => {
    const input = request();
    input.cookies.delete("refresh_token");
    expect((await POST(input)).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...file, end: 1024 * 1024, size: 2 * 1024 * 1024 },
    { ...file, start: -1 },
    { ...file, end: 4096 },
    { ...file, end: 1.5 },
    { ...file, size: Number.MAX_SAFE_INTEGER + 1 },
    { ...file, fileId: "https://foreign.test/file" },
    { ...file, url: "https://foreign.test" },
  ])(
    "rejects invalid span or arbitrary targets before reading: %o",
    async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it("bounds JSON request bytes before refresh or media reads", async () => {
    const result = await POST(request({ ...file, padding: "x".repeat(5000) }));
    expect(result.status).toBe(413);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("binds both the requested namespace and refreshed Google principal to the signed account", async () => {
    expect((await POST(request({ ...file, accountId: "other" }))).status).toBe(
      401,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    providerSequence(mediaResponse(), "other");
    expect((await POST(request())).status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it("returns exactly16 bytes and only an allowed Google media URL; tokens remain upstream", async () => {
    providerSequence(
      mediaResponse(Uint8Array.from({ length: 16 }, (_, index) => index)),
    );
    const response = await POST(request());
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-15/4096");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [url, init] = mockFetch.mock.calls[2];
    expect(url).toBe(
      "https://www.googleapis.com/drive/v3/files/known_track?alt=media&supportsAllDrives=true",
    );
    expect(init).toMatchObject({
      headers: { Range: "bytes=0-15" },
      redirect: "error",
      cache: "no-store",
    });
    expect(JSON.stringify(Object.fromEntries(response.headers))).not.toContain(
      "opaque-test",
    );
  });
  it("cancels an ignored Range200 before consuming the audio body", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    providerSequence(
      new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
        status: 200,
      }),
    );
    const result = await POST(request());
    expect(result.status).toBe(422);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });
  it("does not wait for a stalled cancellation acknowledgement on an ignored Range", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    providerSequence(
      new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
        status: 200,
      }),
    );
    const result = await POST(request());
    expect(result.status).toBe(422);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("retries a valid206 span whose total size changed", async () => {
    const cancel = vi.fn();
    providerSequence(
      new Response(new ReadableStream({ cancel }), {
        status: 206,
        headers: { "Content-Range": "bytes 0-15/4097" },
      }),
    );
    const result = await POST(request());
    expect(result.status).toBe(416);
    expect(result.headers.get("X-DriveBeats-Range-Error")).toBe(
      "version_changed",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("treats a valid clamped span on a shrunk file as a version change without reading its body", async () => {
    const cancel = vi.fn();
    const pull = vi.fn();
    providerSequence(
      new Response(new ReadableStream({ cancel, pull }, { highWaterMark: 0 }), {
        status: 206,
        headers: {
          "Content-Range": "bytes 0-511999/512000",
          "Content-Length": "512000",
        },
      }),
    );
    const response = await POST(
      request({ ...file, size: 5 * 1024 * 1024, end: 1024 * 1024 - 1 }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("X-DriveBeats-Range-Error")).toBe(
      "version_changed",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });
  it.each(["bytes 1-16/4096", "bytes 0-15/*", "invalid"])(
    "still cancels unsupported range responses: %s",
    async (contentRange) => {
      const cancel = vi.fn();
      providerSequence(
        new Response(new ReadableStream({ cancel }), {
          status: 206,
          headers: { "Content-Range": contentRange },
        }),
      );
      expect((await POST(request())).status).toBe(422);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it("rejects excess bytes even when the provider claims the expected range", async () => {
    providerSequence(
      new Response(new Uint8Array(17), {
        status: 206,
        headers: { "Content-Range": "bytes 0-15/4096" },
      }),
    );
    expect((await POST(request())).status).toBe(413);
  });
  it("keeps the combined deadline through a stalled media body and cancels it", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    providerSequence(
      new Response(new ReadableStream({ cancel }), {
        status: 206,
        headers: { "Content-Range": "bytes 0-15/4096" },
      }),
    );
    const result = POST(request());
    await vi.advanceTimersByTimeAsync(12001);
    expect((await result).status).toBe(504);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("applies the same combined deadline to a stalled OAuth response before any media read", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    mockFetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const result = POST(request());
    await vi.advanceTimersByTimeAsync(12001);
    expect((await result).status).toBe(504);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();
  });
  it("cancels upstream body work when the browser disconnects", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    providerSequence(
      new Response(new ReadableStream({ cancel }), {
        status: 206,
        headers: { "Content-Range": "bytes 0-15/4096" },
      }),
    );
    const pending = POST(request(file, { signal: controller.signal }));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    controller.abort();
    expect((await pending).status).toBe(504);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("preserves OAuth rate limits even when the provider sends no JSON error body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "300" } }),
    );
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("X-DriveBeats-Cooldown-Scope")).toBe(
      "metadata",
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });
  it.each([429, 503])(
    "limits userinfo%i Retry-After to metadata requests",
    async (status) => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "opaque-test-access",
              scope: GOOGLE_DRIVE_SCOPE,
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(null, { status, headers: { "Retry-After": "300" } }),
        );
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(response.headers.get("Retry-After")).toBe("300");
      expect(response.headers.get("X-DriveBeats-Cooldown-Scope")).toBe(
        "metadata",
      );
      if (status === 429)
        expect(response.headers.get("X-DriveBeats-Rate-Limited")).toBe("true");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    },
  );
  it("limits OAuth5xx Retry-After to metadata requests", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
        status: 503,
        headers: { "Retry-After": "300" },
      }),
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("X-DriveBeats-Cooldown-Scope")).toBe(
      "metadata",
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });
  it("reports expired identity authorization without requiring a provider JSON error body", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "opaque-test-access",
            scope: GOOGLE_DRIVE_SCOPE,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await POST(request())).status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it("propagates provider429 and its full Retry-After without retrying the media read", async () => {
    providerSequence(
      new Response(null, { status: 429, headers: { "Retry-After": "900" } }),
    );
    const result = await POST(request());
    expect(result.status).toBe(429);
    expect(result.headers.get("X-DriveBeats-Cooldown-Scope")).toBe("drive");
    expect(result.headers.get("Retry-After")).toBe("900");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
  it("marks genuine media service cooldown as Drive-wide while preserving Retry-After", async () => {
    providerSequence(
      new Response(null, { status: 503, headers: { "Retry-After": "180" } }),
    );
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(result.headers.get("X-DriveBeats-Cooldown-Scope")).toBe("drive");
    expect(result.headers.get("Retry-After")).toBe("180");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
  it("exposes only a sanitized quota marker for rate-limit403", async () => {
    providerSequence(
      new Response(
        JSON.stringify({
          error: {
            errors: [
              {
                reason: "userRateLimitExceeded",
                message: "private-provider-message",
              },
            ],
          },
        }),
        { status: 403, headers: { "Retry-After": "600" } },
      ),
    );
    const result = await POST(request());
    expect(result.status).toBe(403);
    expect(result.headers.get("X-DriveBeats-Rate-Limited")).toBe("true");
    expect(result.headers.get("X-DriveBeats-Cooldown-Scope")).toBe("drive");
    expect(result.headers.get("Retry-After")).toBe("600");
    expect(await result.text()).not.toContain("private-provider-message");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
