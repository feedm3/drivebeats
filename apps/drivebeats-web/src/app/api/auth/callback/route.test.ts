// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import { GOOGLE_DRIVE_SCOPE } from "@/lib/google";
import { GET as login } from "../login/route";
import { POST as logout } from "../logout/route";
import { POST as refresh } from "../refresh/route";
import { GET as callback } from "./route";

const database = vi.hoisted(() => ({
  grants: new Map<string, string>(),
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  upsertUser: vi.fn(),
}));
vi.mock("@/db/google-oauth-grants", () => ({
  getGoogleOAuthGrant: database.read,
  saveGoogleOAuthGrant: database.save,
  deleteGoogleOAuthGrant: database.remove,
}));
vi.mock("@/db/users", () => ({ upsertUser: database.upsertUser }));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const scopes = `openid ${GOOGLE_DRIVE_SCOPE}`;
let returnedRefreshToken: string | undefined;
let refreshedError: string | undefined;
let returnedScope: string;
let returnedUserId: string;
let returnedNonce: string;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function idToken() {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      aud: "test-client",
      iss: "https://accounts.google.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: returnedUserId,
      email: `${returnedUserId}@example.test`,
      nonce: returnedNonce,
    }),
  ).toString("base64url");
  return `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url")}`;
}

function cookiesFrom(response: NextResponse) {
  return response.cookies
    .getAll()
    .filter((cookie) => cookie.maxAge !== 0)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function start() {
  const response = await login(
    new NextRequest("https://drivebeats.test/api/auth/login"),
  );
  returnedNonce = response.cookies.get("oauth_nonce")?.value ?? "";
  return response;
}

async function complete(response: NextResponse, suffix = "") {
  returnedNonce = response.cookies.get("oauth_nonce")?.value ?? "";
  return callback(
    new NextRequest(
      `https://drivebeats.test/api/auth/callback?code=test-code&state=${response.cookies.get("oauth_state")?.value}${suffix}`,
      { headers: { cookie: cookiesFrom(response) } },
    ),
  );
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("AUTH_SESSION_SECRET", "test-session-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://drivebeats.test");
  vi.clearAllMocks();
  database.grants.clear();
  database.read.mockImplementation(
    async (id: string) => database.grants.get(id) ?? null,
  );
  database.save.mockImplementation(async (id: string, value: string) => {
    database.grants.set(id, value);
  });
  database.remove.mockImplementation(async (id: string) => {
    database.grants.delete(id);
  });
  returnedRefreshToken = "test-refresh-token";
  refreshedError = undefined;
  returnedScope = scopes;
  returnedUserId = "account-a";
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith("/certs")) {
      return Response.json({
        keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key" }],
      });
    }
    if (String(url) !== "https://oauth2.googleapis.com/token")
      throw new Error("Unexpected network call");
    const body = init?.body as URLSearchParams;
    if (body.get("grant_type") === "refresh_token") {
      return Response.json(
        refreshedError
          ? { error: refreshedError }
          : { access_token: "test-access", expires_in: 3600, scope: scopes },
      );
    }
    return Response.json({
      id_token: idToken(),
      refresh_token: returnedRefreshToken,
      scope: returnedScope,
      access_token: "test-access",
      expires_in: 3600,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reuses the approved connection after logout, without asking Google for consent again", async () => {
  const first = await complete(await start());
  expect(first.headers.get("location")).toBe("https://drivebeats.test/app");
  expect(database.grants.get("account-a")).not.toContain("test-refresh-token");
  const signedOut = await logout();
  expect(signedOut.cookies.get("refresh_token")?.maxAge).toBe(0);
  expect(signedOut.cookies.get(AUTH_SESSION_COOKIE)?.maxAge).toBe(0);
  returnedRefreshToken = undefined; // Google's normal returning-user response.
  const secondLogin = await start();
  expect(
    new URL(secondLogin.headers.get("location") ?? "").searchParams.get(
      "prompt",
    ),
  ).toBeNull();
  const second = await complete(secondLogin);
  expect(second.headers.get("location")).toBe("https://drivebeats.test/app");
  expect(
    parseAuthSession(second.cookies.get(AUTH_SESSION_COOKIE)?.value)?.user.id,
  ).toBe("account-a");
  const refreshed = await refresh(
    new NextRequest("https://drivebeats.test/api/auth/refresh", {
      headers: { cookie: cookiesFrom(second) },
    }),
  );
  expect(refreshed.status).toBe(200);
  expect(await refreshed.json()).toMatchObject({
    access_token: "test-access",
    user: { id: "account-a" },
  });
});

it("requests recovery consent once when an existing Google approval has no saved token", async () => {
  returnedRefreshToken = undefined;
  const recovery = await complete(await start());
  const url = new URL(recovery.headers.get("location") ?? "");
  expect(url.searchParams.get("prompt")).toBe("consent");
  expect(url.searchParams.get("login_hint")).toBe("account-a");
  const failed = await complete(recovery);
  expect(failed.headers.get("location")).toBe(
    "https://drivebeats.test/?authError=missing_refresh_token",
  );
  expect(failed.cookies.get("oauth_consent_retry")?.maxAge).toBe(0);
});

it("saves the recovered grant so future logins no longer require recovery", async () => {
  returnedRefreshToken = undefined;
  const recovery = await complete(await start());
  returnedRefreshToken = "replacement-token";
  expect((await complete(recovery)).headers.get("location")).toBe(
    "https://drivebeats.test/app",
  );
  returnedRefreshToken = undefined;
  expect((await complete(await start())).headers.get("location")).toBe(
    "https://drivebeats.test/app",
  );
});

it("never reuses another account's stored Drive connection", async () => {
  await complete(await start());
  returnedUserId = "account-b";
  returnedRefreshToken = undefined;
  const recovery = await complete(await start());
  expect(
    new URL(recovery.headers.get("location") ?? "").searchParams.get(
      "login_hint",
    ),
  ).toBe("account-b");
  expect(database.read).toHaveBeenLastCalledWith("account-b");
  expect(
    fetchMock.mock.calls.filter(
      ([, init]) =>
        (init?.body as URLSearchParams)?.get("grant_type") === "refresh_token",
    ),
  ).toHaveLength(0);
});

it("recovers a revoked Google connection", async () => {
  await complete(await start());
  returnedRefreshToken = undefined;
  refreshedError = "invalid_grant";
  const recovery = await complete(await start());
  expect(
    new URL(recovery.headers.get("location") ?? "").searchParams.get("prompt"),
  ).toBe("consent");
  expect(database.grants.has("account-a")).toBe(false);
});

it("recovers a saved connection belonging to another OAuth client and reuses the replacement", async () => {
  await complete(await start());
  returnedRefreshToken = undefined;
  refreshedError = "unauthorized_client";
  const recovery = await complete(await start());
  const url = new URL(recovery.headers.get("location") ?? "");
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("prompt")).toBe("consent");
  expect(url.searchParams.get("login_hint")).toBe("account-a");
  // The old grant may still work with its original client. Recovery does not
  // delete it or revoke Google's approval before a replacement is available.
  expect(database.remove).not.toHaveBeenCalled();
  expect(database.grants.has("account-a")).toBe(true);

  returnedRefreshToken = "current-client-refresh-token";
  refreshedError = undefined;
  expect((await complete(recovery)).headers.get("location")).toBe(
    "https://drivebeats.test/app",
  );
  returnedRefreshToken = undefined;
  expect((await complete(await start())).headers.get("location")).toBe(
    "https://drivebeats.test/app",
  );
});

it("does not loop when Google withholds a replacement for another OAuth client's token", async () => {
  await complete(await start());
  returnedRefreshToken = undefined;
  refreshedError = "unauthorized_client";
  const recovery = await complete(await start());
  const failed = await complete(recovery);
  expect(failed.headers.get("location")).toBe(
    "https://drivebeats.test/?authError=missing_refresh_token",
  );
  expect(failed.cookies.get("oauth_consent_retry")?.maxAge).toBe(0);
});

it("preserves approval and avoids re-consent during a transient Google failure", async () => {
  await complete(await start());
  returnedRefreshToken = undefined;
  refreshedError = "temporarily_unavailable";
  const response = await complete(await start());
  expect(response.headers.get("location")).toBe(
    "https://drivebeats.test/?authError=authentication_failed",
  );
  expect(database.grants.has("account-a")).toBe(true);
});

it("rejects callbacks lacking Drive permission before loading any stored grant", async () => {
  returnedScope = "openid";
  const response = await complete(await start());
  expect(response.headers.get("location")).toBe(
    "https://drivebeats.test/?authError=missing_drive_scope",
  );
  expect(database.read).not.toHaveBeenCalled();
  expect(database.save).not.toHaveBeenCalled();
});

it("verifies the nonce before loading or persisting provider credentials", async () => {
  const attempt = await start();
  returnedNonce = "wrong-nonce";
  const response = await callback(
    new NextRequest(
      `https://drivebeats.test/api/auth/callback?code=test&state=${attempt.cookies.get("oauth_state")?.value}`,
      { headers: { cookie: cookiesFrom(attempt) } },
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://drivebeats.test/?authError=authentication_failed",
  );
  expect(database.read).not.toHaveBeenCalled();
  expect(database.save).not.toHaveBeenCalled();
});

it("rejects mismatched state without exchanging credentials", async () => {
  const attempt = await start();
  const response = await callback(
    new NextRequest(
      "https://drivebeats.test/api/auth/callback?code=test&state=wrong",
      { headers: { cookie: cookiesFrom(attempt) } },
    ),
  );
  expect(response.headers.get("location")).toBe(
    "https://drivebeats.test/?authError=invalid_oauth_state",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("identifies a failed grant lookup without logging database credentials", async () => {
  returnedRefreshToken = undefined;
  database.read.mockRejectedValueOnce(
    Object.assign(new Error("postgres://user:private-password@db/private"), {
      code: "42P01",
    }),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await complete(await start());
    expect(response.headers.get("location")).toBe(
      "https://drivebeats.test/?authError=authentication_failed",
    );
    expect(log).toHaveBeenCalledWith("OAuth grant storage or refresh failed", {
      stage: "grant_lookup",
      reason: "database_schema",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-password");
    expect(database.save).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("identifies provider refresh failures without logging provider text or tokens", async () => {
  await complete(await start());
  returnedRefreshToken = undefined;
  refreshedError = "provider-private-error-detail";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await complete(await start());
    expect(response.headers.get("location")).toBe(
      "https://drivebeats.test/?authError=authentication_failed",
    );
    expect(log).toHaveBeenCalledWith("OAuth grant storage or refresh failed", {
      stage: "grant_refresh",
      reason: "provider_error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(refreshedError);
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-refresh-token");
  } finally {
    log.mockRestore();
  }
});
