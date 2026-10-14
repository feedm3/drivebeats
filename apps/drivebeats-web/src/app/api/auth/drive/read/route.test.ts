// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/lib/auth-session";
import { refreshDriveReadToken } from "@/lib/drive-read-auth";
import { getServerAuthSession } from "@/lib/server-auth";
import { GET } from "./route";

vi.mock("@/lib/server-auth", () => ({ getServerAuthSession: vi.fn() }));
vi.mock("@/lib/drive-read-auth", () => ({ refreshDriveReadToken: vi.fn() }));

const driveSession: AuthSession = {
  grantedScopes: ["https://www.googleapis.com/auth/drive.file"],
  user: {
    id: "account-one",
    email: "user@example.com",
    name: null,
    picture: null,
  },
};
const freshToken = { status: 200 as const, accessToken: "server-access-token" };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function request(query = "", options: RequestInit = {}) {
  const headers = new Headers({ "X-DriveBeats-Read": "1" });
  for (const [key, value] of new Headers(options.headers))
    headers.set(key, value);
  if (!headers.has("cookie"))
    headers.set("cookie", "refresh_token=server-refresh-token");
  return new NextRequest(
    `https://www.drivebeats.app/api/auth/drive/read${query}`,
    {
      ...options,
      signal: options.signal ?? undefined,
      headers,
    },
  );
}

beforeEach(() => {
  vi.mocked(getServerAuthSession).mockResolvedValue(driveSession);
  vi.mocked(refreshDriveReadToken).mockResolvedValue(freshToken);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function expectUnauthorized(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "Unauthorized" });
  expect(fetchMock).not.toHaveBeenCalled();
}

describe("server-authenticated Drive reads", () => {
  it.each([
    ["missing session", null, "refresh_token=server-refresh-token"],
    [
      "missing Drive scope",
      { ...driveSession, grantedScopes: ["openid"] },
      "refresh_token=server-refresh-token",
    ],
    ["missing refresh cookie", driveSession, ""],
  ] satisfies [string, AuthSession | null, string][])(
    "rejects %s without contacting Google, even with browser Authorization",
    async (_name, session, cookie) => {
      vi.mocked(getServerAuthSession).mockResolvedValue(session);
      await expectUnauthorized(
        await GET(
          request("", {
            headers: { Cookie: cookie, Authorization: "Bearer browser-token" },
          }),
        ),
      );
      expect(refreshDriveReadToken).not.toHaveBeenCalled();
    },
  );

  it("validates the fixed read target before exchanging the refresh credential", async () => {
    const response = await GET(request("?url=https://evil.example"));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(refreshDriveReadToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 502] as const)(
    "preserves token exchange status %s without returning OAuth diagnostics",
    async (status) => {
      vi.mocked(refreshDriveReadToken).mockResolvedValueOnce({ status });
      const response = await GET(request());
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error:
          status === 401
            ? "Unauthorized"
            : "Google Drive could not be reached. Try again.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["", "0"])(
    "rejects a missing or incorrect read marker before authentication",
    async (marker) => {
      const incoming = request("", {
        headers: { "X-DriveBeats-Read": marker },
      });
      if (!marker) incoming.headers.delete("X-DriveBeats-Read");
      const response = await GET(incoming);
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Forbidden" });
      expect(getServerAuthSession).not.toHaveBeenCalled();
      expect(refreshDriveReadToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses only the server-refreshed credential for an authorized paginated read", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ files: [{ id: "track", name: "Track.mp3" }] }),
    );
    const incoming = request("?pageSize=1000&pageToken=page-two", {
      headers: { Authorization: "Bearer ignored-browser-token" },
    });
    const response = await GET(incoming);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      files: [{ id: "track", name: "Track.mp3" }],
    });
    expect(refreshDriveReadToken).toHaveBeenCalledWith(
      "server-refresh-token",
      incoming.signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, options] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      "https://www.googleapis.com/drive/v3/files?pageSize=1000&pageToken=page-two",
    );
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer server-access-token" },
      signal: incoming.signal,
      cache: "no-store",
      redirect: "error",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("streams selected audio before its download finishes using server authentication", async () => {
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
    const incoming = request("?fileId=selected-track&alt=media");
    const response = await GET(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const [target, options] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      "https://www.googleapis.com/drive/v3/files/selected-track?alt=media",
    );
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer server-access-token" },
      signal: incoming.signal,
    });
    const reader = response.body?.getReader();
    expect(await reader?.read()).toEqual({
      done: false,
      value: new Uint8Array([1, 2, 3]),
    });
    source?.close();
    expect(await reader?.read()).toMatchObject({ done: true });
  });

  it.each(["refresh", "read"] as const)(
    "reports %s transport failure without exposing diagnostics",
    async (stage) => {
      const failure = new TypeError("private upstream diagnostic");
      if (stage === "refresh")
        vi.mocked(refreshDriveReadToken).mockRejectedValueOnce(failure);
      else fetchMock.mockRejectedValueOnce(failure);
      const response = await GET(request());
      expect(response.status).toBe(502);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "Google Drive could not be reached. Try again.",
      });
      expect(fetchMock).toHaveBeenCalledTimes(stage === "read" ? 1 : 0);
    },
  );

  it("does not exchange credentials for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      GET(request("", { signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(refreshDriveReadToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start a Drive read if cancellation happens during token refresh", async () => {
    const controller = new AbortController();
    vi.mocked(refreshDriveReadToken).mockImplementationOnce(async () => {
      controller.abort();
      return freshToken;
    });
    await expect(
      GET(request("", { signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates cancellation of a Drive read instead of returning a gateway failure", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("Request cancelled", "AbortError");
    fetchMock.mockImplementationOnce(async (_target, options) => {
      expect(options?.signal?.aborted).toBe(false);
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw aborted;
    });
    await expect(GET(request("", { signal: controller.signal }))).rejects.toBe(
      aborted,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
