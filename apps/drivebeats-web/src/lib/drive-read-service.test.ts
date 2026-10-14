// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDriveReadTarget, relayDriveRead } from "./drive-read-service";

afterEach(() => vi.unstubAllGlobals());

describe("Drive read target validation", () => {
  it("keeps paginated Library reads on the fixed Google Drive files endpoint", () => {
    const params = new URLSearchParams({
      q: "trashed = false and mimeType contains 'audio/'",
      fields: "nextPageToken,incompleteSearch,files(id,name,parents)",
      pageSize: "1000",
      pageToken: "next page token",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    const target = parseDriveReadTarget(params);

    expect(target?.origin).toBe("https://www.googleapis.com");
    expect(target?.pathname).toBe("/drive/v3/files");
    expect(target?.searchParams.get("pageToken")).toBe("next page token");
    expect(target?.searchParams.get("q")).toBe(params.get("q"));
  });

  it("limits a selected audio read to that file's media endpoint", () => {
    const target = parseDriveReadTarget(
      new URLSearchParams({ fileId: "selected_track-123", alt: "media" }),
    );

    expect(target?.href).toBe(
      "https://www.googleapis.com/drive/v3/files/selected_track-123?alt=media",
    );
    expect(target?.searchParams.has("fileId")).toBe(false);
  });

  it.each([
    "url=https%3A%2F%2Fevil.example%2Fprivate",
    "access_token=secret",
    "method=DELETE",
    "fileId=one&fileId=two",
    "q=first&q=second",
    "fileId=..%2F..%2Fpermissions",
    "fileId=https%3A%2F%2Fevil.example",
    "fileId=track%3Falt%3Dmedia",
    "fileId=",
    "alt=media",
    "fileId=track&alt=upload",
  ])("rejects an unsafe or ambiguous target: %s", (query) => {
    expect(parseDriveReadTarget(new URLSearchParams(query))).toBeNull();
  });
});

describe("Drive read streaming", () => {
  it("forwards audio incrementally, using only GET and the supplied authorization", async () => {
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(new TextEncoder().encode("first audio chunk"));
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": "bytes 0-16/100",
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=3600",
          "Set-Cookie": "upstream=private",
          Location: "https://another.example/redirect",
          "Content-Length": "100",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const target = new URL(
      "https://www.googleapis.com/drive/v3/files/track?alt=media",
    );

    const response = await relayDriveRead(target, "Bearer test-token", signal);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(target, {
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
      signal,
      cache: "no-store",
      redirect: "error",
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-16/100");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    for (const header of ["Set-Cookie", "Location", "Content-Length"]) {
      expect(response.headers.has(header)).toBe(false);
    }
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe("first audio chunk");
    expect(first?.done).toBe(false);
    source?.close();
    expect(await reader?.read()).toMatchObject({ done: true });
  });

  it("preserves Google permission failures instead of disguising them as a successful read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { error: { message: "Insufficient permissions" } },
          {
            status: 403,
            headers: { "Cache-Control": "public, max-age=3600" },
          },
        ),
      ),
    );
    const response = await relayDriveRead(
      new URL("https://www.googleapis.com/drive/v3/files"),
      "Bearer test-token",
      new AbortController().signal,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: "Insufficient permissions" },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("preserves Google's retry timing when a read is rate limited", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: "Rate limit exceeded" } },
          { status: 429, headers: { "Retry-After": "120" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await relayDriveRead(
      new URL("https://www.googleapis.com/drive/v3/files"),
      "Bearer test-token",
      new AbortController().signal,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: { message: "Rate limit exceeded" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
