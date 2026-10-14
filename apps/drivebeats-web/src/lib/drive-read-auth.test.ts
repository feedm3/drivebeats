// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshDriveReadToken } from "./drive-read-auth";

const token = { access_token: "dummy-access-token", expires_in: 3600 };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "dummy-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "dummy-client-secret");
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function exchange(signal = new AbortController().signal) {
  return refreshDriveReadToken("dummy-refresh-token", signal);
}

describe("Drive relay token exchange", () => {
  it("uses server credentials and accepts unchanged scopes omitted by OAuth", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(token));
    expect(await exchange()).toEqual({
      status: 200,
      accessToken: "dummy-access-token",
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(options?.method).toBe("POST");
    expect(Object.fromEntries(options?.body as URLSearchParams)).toEqual({
      refresh_token: "dummy-refresh-token",
      client_id: "dummy-client-id",
      client_secret: "dummy-client-secret",
      grant_type: "refresh_token",
    });
  });

  it("accepts an explicitly returned Drive scope", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ...token,
        scope: "openid https://www.googleapis.com/auth/drive.file",
      }),
    );
    expect(await exchange()).toEqual({
      status: 200,
      accessToken: "dummy-access-token",
    });
  });

  it.each([
    [
      400,
      { error: "invalid_grant", error_description: "private OAuth diagnostic" },
    ],
    [200, { ...token, scope: "openid" }],
    [200, { ...token, scope: "" }],
  ])(
    "requires sign-in only for revoked grants or returned insufficient scopes",
    async (status, body) => {
      fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
      expect(await exchange()).toEqual({ status: 401 });
    },
  );

  it.each([
    [503, token],
    [
      503,
      { error: "invalid_grant", error_description: "private OAuth diagnostic" },
    ],
    [503, {}],
    [429, { error: "invalid_grant" }],
    [401, { error: "invalid_grant" }],
    [
      400,
      {
        error: "invalid_client",
        error_description: "private OAuth diagnostic",
      },
    ],
    [200, { error: "invalid_client" }],
    [200, null],
    [200, []],
    [200, { expires_in: 3600 }],
    [200, { ...token, access_token: "" }],
    [200, { ...token, access_token: "malformed token" }],
    [200, { access_token: "dummy-access-token" }],
    [200, { ...token, expires_in: 0 }],
    [200, { ...token, expires_in: -1 }],
    [200, { ...token, expires_in: "3600" }],
    [200, { ...token, scope: ["openid"] }],
  ])(
    "preserves sign-in when provider status %s or response is unusable",
    async (status, body) => {
      fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
      expect(await exchange()).toEqual({ status: 502 });
    },
  );

  it("preserves sign-in when Google returns malformed JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("private malformed provider response"),
    );
    expect(await exchange()).toEqual({ status: 502 });
  });

  it("does not expose transport diagnostics", async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError("private upstream diagnostic"),
    );
    expect(await exchange()).toEqual({ status: 502 });
  });

  it("preserves sign-in when server configuration is missing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(await exchange()).toEqual({ status: 502 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not exchange an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exchange(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates cancellation after exchange instead of returning credentials", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return Response.json(token);
    });
    await expect(exchange(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
