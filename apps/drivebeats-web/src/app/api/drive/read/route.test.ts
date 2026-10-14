// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/lib/auth-session";
import { getServerAuthSession } from "@/lib/server-auth";
import { GET } from "./route";

vi.mock("@/lib/server-auth", () => ({
  getServerAuthSession: vi.fn(),
}));

const driveSession: AuthSession = {
  grantedScopes: ["https://www.googleapis.com/auth/drive.file"],
  user: {
    id: "account-one",
    email: "user@example.com",
    name: null,
    picture: null,
  },
};

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.mocked(getServerAuthSession).mockResolvedValue(driveSession);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Drive read authorization", () => {
  it.each([
    ["missing session", null, "Bearer test-token"],
    [
      "missing Drive scope",
      { ...driveSession, grantedScopes: ["openid"] },
      "Bearer test-token",
    ],
    ["missing access token", driveSession, undefined],
    ["wrong authorization scheme", driveSession, "Basic test-token"],
    ["multiple token values", driveSession, "Bearer first second"],
    ["oversized token", driveSession, `Bearer ${"x".repeat(2049)}`],
  ] satisfies [string, AuthSession | null, string | undefined][])(
    "rejects %s before making any Google request",
    async (_name, session, authorization) => {
      vi.mocked(getServerAuthSession).mockResolvedValue(session);
      const request = new Request("https://www.drivebeats.app/api/drive/read", {
        headers: authorization ? { Authorization: authorization } : undefined,
      });

      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects an arbitrary destination even with a signed-in Drive account", async () => {
    const response = await GET(
      new Request(
        "https://www.drivebeats.app/api/drive/read?url=https://evil.example",
        {
          headers: { Authorization: "Bearer test-token" },
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves an authorized paginated read without exposing credentials in the upstream URL", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ files: [{ id: "track", name: "Track.mp3" }] }),
    );
    const request = new Request(
      "https://www.drivebeats.app/api/drive/read?pageSize=1000&pageToken=page-two",
      { headers: { Authorization: "Bearer test-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [{ id: "track", name: "Track.mp3" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, options] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      "https://www.googleapis.com/drive/v3/files?pageSize=1000&pageToken=page-two",
    );
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
      signal: request.signal,
      cache: "no-store",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("streams selected audio through the authorized route before the download finishes", async () => {
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const audio = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(audio, { headers: { "Content-Type": "audio/mpeg" } }),
    );
    const request = new Request(
      "https://www.drivebeats.app/api/drive/read?fileId=selected-track&alt=media",
      { headers: { Authorization: "Bearer test-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const [target, options] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      "https://www.googleapis.com/drive/v3/files/selected-track?alt=media",
    );
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
      signal: request.signal,
    });
    const reader = response.body?.getReader();
    expect(await reader?.read()).toEqual({
      done: false,
      value: new Uint8Array([1, 2, 3]),
    });
    source?.close();
    expect(await reader?.read()).toMatchObject({ done: true });
  });

  it("reports an uncached gateway failure without leaking upstream diagnostics", async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError("Fetch failed for private upstream diagnostic"),
    );
    const response = await GET(
      new Request("https://www.drivebeats.app/api/drive/read", {
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Google Drive could not be reached. Try again.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates an explicitly cancelled request instead of converting it to a gateway failure", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("Request cancelled", "AbortError");
    fetchMock.mockImplementationOnce(async (_target, options) => {
      expect(options?.signal?.aborted).toBe(false);
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw aborted;
    });
    const request = new Request("https://www.drivebeats.app/api/drive/read", {
      headers: { Authorization: "Bearer test-token" },
      signal: controller.signal,
    });

    await expect(GET(request)).rejects.toBe(aborted);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
