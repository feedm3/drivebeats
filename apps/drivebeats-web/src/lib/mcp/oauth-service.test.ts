// @vitest-environment node
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeMcpAuthorizationCode,
  getMcpAuthorizationCode,
  saveMcpAuthorizationCode,
} from "@/db/mcp-authorization-codes";
import { createMcpGrant, getMcpGrant, revokeMcpGrant } from "@/db/mcp-grants";
import {
  consumeMcpLinkRequest,
  getMcpLinkRequest,
} from "@/db/mcp-link-requests";
import {
  consumeMcpRefreshToken,
  getMcpRefreshToken,
  saveMcpRefreshToken,
} from "@/db/mcp-refresh-tokens";
import { encryptMcpSecret } from "./auth";
import {
  approveMcpAuthorization,
  completeMcpGoogleAuthorization,
  exchangeMcpToken,
  revokeMcpAuthorization,
  startMcpAuthorization,
  validateMcpAuthorizationQuery,
} from "./oauth-service";

vi.mock("@/db/mcp-authorization-codes", () => ({
  getMcpAuthorizationCode: vi.fn(),
  consumeMcpAuthorizationCode: vi.fn(),
  saveMcpAuthorizationCode: vi.fn(),
}));
vi.mock("@/db/mcp-grants", () => ({
  getMcpGrant: vi.fn(),
  clearExpiredMcpCredentials: vi.fn(),
  createMcpGrant: vi.fn(),
  revokeMcpGrant: vi.fn(),
}));
vi.mock("@/db/mcp-link-requests", () => ({
  getMcpLinkRequest: vi.fn(),
  saveMcpLinkRequest: vi.fn(),
  updateMcpLinkRequest: vi.fn(),
  consumeMcpLinkRequest: vi.fn(),
}));
vi.mock("@/db/mcp-refresh-tokens", () => ({
  getMcpRefreshToken: vi.fn(),
  saveMcpRefreshToken: vi.fn(),
  consumeMcpRefreshToken: vi.fn(),
}));
vi.mock("@/db/users", () => ({ upsertUser: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const verifier =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const query = {
  client_id: "chatgpt",
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  response_type: "code",
  resource: "https://drivebeats.example/mcp",
  state: "chatgpt-state",
  scope: "profile:read",
  code_challenge: challenge,
  code_challenge_method: "S256",
};
const profile = {
  id: "google-sub",
  email: "user@example.test",
  name: null,
  picture: null,
};
const grant = {
  id,
  googleUserId: profile.id,
  clientId: "chatgpt",
  profile,
  scopes: ["profile:read"],
  encryptedGoogleRefreshToken: null,
  expiresAt: new Date(Date.now() + 600000),
  revokedAt: null,
};
function tokenRequest(body: Record<string, string>) {
  return new NextRequest("https://drivebeats.example/api/mcp/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}
const exchange = {
  grant_type: "authorization_code",
  client_id: "chatgpt",
  code: "stored-code",
  redirect_uri: query.redirect_uri,
  resource: query.resource,
  code_verifier: verifier,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats.example");
  vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
  vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", query.redirect_uri);
  vi.stubEnv(
    "MCP_ACCESS_TOKEN_SIGNING_KEY",
    Buffer.alloc(32, 1).toString("base64url"),
  );
  vi.stubEnv(
    "MCP_CREDENTIAL_ENCRYPTION_KEY",
    Buffer.alloc(32, 2).toString("base64url"),
  );
  vi.mocked(getMcpGrant).mockResolvedValue(grant);
  vi.mocked(getMcpAuthorizationCode).mockResolvedValue({
    grant_id: id,
    expires_at: new Date(Date.now() + 60000),
    redirect_uri: query.redirect_uri,
    code_challenge: challenge,
  });
  vi.mocked(consumeMcpAuthorizationCode).mockResolvedValue(true);
});
describe("OAuth request boundaries", () => {
  it.each([
    { redirect_uri: "https://attacker.example/callback" },
    { resource: "https://attacker.example/mcp" },
    { code_challenge_method: "plain" },
    { state: "" },
    { scope: "drive:*" },
    { client_id: "unknown" },
  ])("rejects unsafe authorization %j", (change) => {
    expect(() =>
      validateMcpAuthorizationQuery({ ...query, ...change }),
    ).toThrow();
  });
  it("rejects duplicate authorization parameters", async () => {
    const params = new URLSearchParams(query);
    params.append("state", "duplicate");
    expect(
      (
        await startMcpAuthorization(
          new NextRequest(
            `https://drivebeats.example/api/mcp/oauth/authorize?${params}`,
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("exchanges S256 code and issues scoped DriveBeats tokens", async () => {
    const response = await exchangeMcpToken(tokenRequest(exchange));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.access_token).toBeTypeOf("string");
    expect(body.refresh_token).toBeTypeOf("string");
    expect(body.scope).toBe("profile:read");
    expect(body.expires_in).toBeLessThanOrEqual(900);
  });
  it.each([
    { code_verifier: "wrong-but-valid-verifier-abcdefghijklmnopqrstuvwxyz" },
    { redirect_uri: "https://attacker.example/callback" },
    { client_id: "unknown" },
  ])("rejects PKCE/callback/client violation %j", async (change) => {
    expect(
      (await exchangeMcpToken(tokenRequest({ ...exchange, ...change }))).status,
    ).toBe(400);
    expect(saveMcpRefreshToken).not.toHaveBeenCalled();
  });
  it("checks token resource before consuming an authorization code", async () => {
    expect(
      (
        await exchangeMcpToken(
          tokenRequest({ ...exchange, resource: "https://other.example/mcp" }),
        )
      ).status,
    ).toBe(400);
    expect(consumeMcpAuthorizationCode).not.toHaveBeenCalled();
  });
  it("rejects concurrent code redemption when atomic consumption fails", async () => {
    vi.mocked(consumeMcpAuthorizationCode).mockResolvedValue(false);
    expect((await exchangeMcpToken(tokenRequest(exchange))).status).toBe(400);
    expect(saveMcpRefreshToken).not.toHaveBeenCalled();
  });
  it("rotates refresh credentials and rejects concurrent refresh", async () => {
    vi.mocked(getMcpRefreshToken).mockResolvedValue({
      grant_id: id,
      expires_at: new Date(Date.now() + 60000),
      scopes: ["profile:read"],
      consumed_at: null,
    });
    vi.mocked(consumeMcpRefreshToken).mockResolvedValue(true);
    const req = {
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: "old-refresh",
      resource: query.resource,
    };
    expect((await exchangeMcpToken(tokenRequest(req))).status).toBe(200);
    expect(saveMcpRefreshToken).toHaveBeenCalledOnce();
    vi.mocked(consumeMcpRefreshToken).mockResolvedValue(false);
    expect((await exchangeMcpToken(tokenRequest(req))).status).toBe(400);
    expect(saveMcpRefreshToken).toHaveBeenCalledOnce();
    expect(revokeMcpGrant).toHaveBeenCalledWith(id, profile.id);
  });
  it("revokes grant family on rotated refresh replay", async () => {
    vi.mocked(getMcpRefreshToken).mockResolvedValue({
      grant_id: id,
      expires_at: new Date(Date.now() + 60000),
      scopes: ["profile:read"],
      consumed_at: new Date(),
    });
    expect(
      (
        await exchangeMcpToken(
          tokenRequest({
            grant_type: "refresh_token",
            client_id: "chatgpt",
            refresh_token: "old",
            resource: query.resource,
          }),
        )
      ).status,
    ).toBe(400);
    expect(revokeMcpGrant).toHaveBeenCalledWith(id);
  });
  it("requires valid Google callback state even for canceled consent", async () => {
    vi.mocked(getMcpLinkRequest).mockResolvedValue(
      await encryptMcpSecret(
        { query, state: "google-state", nonce: "nonce", csrf: "csrf" },
        `link:${id}`,
      ),
    );
    const req = new NextRequest(
      "https://drivebeats.example/api/mcp/oauth/google?state=wrong&error=access_denied",
      { headers: { cookie: `__Host-mcp_link=${id}` } },
    );
    expect((await completeMcpGoogleAuthorization(req)).status).toBe(400);
    expect(consumeMcpLinkRequest).not.toHaveBeenCalled();
  });
  it("returns cancellation only to allowlisted ChatGPT callback with issuer", async () => {
    vi.mocked(getMcpLinkRequest).mockResolvedValue(
      await encryptMcpSecret(
        { query, state: "google-state", nonce: "nonce", csrf: "csrf" },
        `link:${id}`,
      ),
    );
    const req = new NextRequest(
      "https://drivebeats.example/api/mcp/oauth/google?state=google-state&error=access_denied",
      { headers: { cookie: `__Host-mcp_link=${id}` } },
    );
    const res = await completeMcpGoogleAuthorization(req);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://chatgpt.com");
    expect(location.searchParams.get("state")).toBe("chatgpt-state");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("iss")).toBe("https://drivebeats.example");
  });
  it("rejects consent POST from another origin", async () => {
    const res = await approveMcpAuthorization(
      new NextRequest("https://drivebeats.example/api/mcp/oauth/authorize", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "csrf=token&decision=approve",
      }),
    );
    expect(res.status).toBe(403);
    expect(consumeMcpLinkRequest).not.toHaveBeenCalled();
  });
  async function consentRequest(decision: string, csrf = "csrf") {
    vi.mocked(getMcpLinkRequest).mockResolvedValue(
      await encryptMcpSecret(
        {
          query,
          state: "google-state",
          nonce: "nonce",
          csrf: "csrf",
          profile,
          googleRefreshToken: "sensitive-provider-refresh",
        },
        `link:${id}`,
      ),
    );
    vi.mocked(consumeMcpLinkRequest).mockResolvedValue("consumed");
    return new NextRequest(
      "https://drivebeats.example/api/mcp/oauth/authorize",
      {
        method: "POST",
        headers: {
          origin: "https://drivebeats.example",
          cookie: `__Host-mcp_link=${id}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf, decision }),
      },
    );
  }
  it("approves explicit consent and returns a PKCE code plus issuer", async () => {
    const response = await approveMcpAuthorization(
      await consentRequest("approve"),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://chatgpt.com");
    expect(location.searchParams.get("code")).toBeTypeOf("string");
    expect(location.searchParams.has("error")).toBe(false);
    expect(location.searchParams.get("iss")).toBe("https://drivebeats.example");
    expect(location.searchParams.get("state")).toBe(query.state);
    expect(createMcpGrant).toHaveBeenCalledOnce();
    expect(saveMcpAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ challenge, redirectUri: query.redirect_uri }),
    );
    const created = vi.mocked(createMcpGrant).mock.calls[0][0];
    expect(created.googleUserId).toBe(profile.id);
    expect(created.encryptedGoogleRefreshToken).not.toContain(
      "sensitive-provider-refresh",
    );
    expect(response.headers.get("location")).not.toContain(
      "sensitive-provider-refresh",
    );
  });
  it.each(["wrong", ""])(
    "rejects wrong or missing csrf %j without creating grant",
    async (csrf) => {
      expect(
        (await approveMcpAuthorization(await consentRequest("approve", csrf)))
          .status,
      ).toBe(403);
      expect(createMcpGrant).not.toHaveBeenCalled();
      expect(consumeMcpLinkRequest).not.toHaveBeenCalled();
    },
  );
  it("cancels connection consent and never persists a grant", async () => {
    const response = await approveMcpAuthorization(
      await consentRequest("cancel"),
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.has("code")).toBe(false);
    expect(createMcpGrant).not.toHaveBeenCalled();
    expect(consumeMcpLinkRequest).toHaveBeenCalledOnce();
  });
  it("rejects replayed approval after atomic pending request consumption", async () => {
    const request = await consentRequest("approve");
    vi.mocked(consumeMcpLinkRequest).mockResolvedValue(undefined);
    expect((await approveMcpAuthorization(request)).status).toBe(403);
    expect(createMcpGrant).not.toHaveBeenCalled();
  });
  it("rejects over-limit token body before OAuth model access", async () => {
    const response = await exchangeMcpToken(
      tokenRequest({ ...exchange, padding: "x".repeat(9000) }),
    );
    expect(response.status).toBe(400);
    expect(getMcpAuthorizationCode).not.toHaveBeenCalled();
  });
  it("rejects refresh scope escalation", async () => {
    vi.mocked(getMcpRefreshToken).mockResolvedValue({
      grant_id: id,
      expires_at: new Date(Date.now() + 60000),
      scopes: ["profile:read"],
      consumed_at: null,
    });
    vi.mocked(consumeMcpRefreshToken).mockResolvedValue(true);
    const response = await exchangeMcpToken(
      tokenRequest({
        grant_type: "refresh_token",
        client_id: "chatgpt",
        refresh_token: "old",
        resource: query.resource,
        scope: "profile:read media:read",
      }),
    );
    expect(response.status).toBe(400);
    expect(saveMcpRefreshToken).not.toHaveBeenCalled();
  });
  it("supports RFC7009 form revocation and retains cloud account data", async () => {
    vi.mocked(getMcpRefreshToken).mockResolvedValue({
      grant_id: id,
      expires_at: new Date(Date.now() + 60000),
      scopes: ["profile:read"],
      consumed_at: null,
    });
    const request = new NextRequest(
      "https://drivebeats.example/api/mcp/oauth/revoke",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt",
          token: "refresh",
          token_type_hint: "refresh_token",
        }),
      },
    );
    expect((await revokeMcpAuthorization(request)).status).toBe(200);
    expect(revokeMcpGrant).toHaveBeenCalledWith(id);
  });
  it("RFC7009 unknown tokens succeed without revealing their existence", async () => {
    vi.mocked(getMcpRefreshToken).mockResolvedValue(null);
    const request = new NextRequest(
      "https://drivebeats.example/api/mcp/oauth/revoke",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: "chatgpt", token: "unknown" }),
      },
    );
    expect((await revokeMcpAuthorization(request)).status).toBe(200);
    expect(revokeMcpGrant).not.toHaveBeenCalled();
  });
  it.each([
    { clientId: "previous-client" },
    { profile: { ...profile, id: "different-account" } },
  ])("rejects code and refresh grant ownership mismatch %j", async (change) => {
    vi.mocked(getMcpGrant).mockResolvedValue({ ...grant, ...change });
    expect((await exchangeMcpToken(tokenRequest(exchange))).status).toBe(400);
    expect(consumeMcpAuthorizationCode).not.toHaveBeenCalled();
    vi.mocked(getMcpRefreshToken).mockResolvedValue({
      grant_id: id,
      expires_at: new Date(Date.now() + 60000),
      scopes: ["profile:read"],
      consumed_at: null,
    });
    const refresh = {
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: "old",
      resource: query.resource,
    };
    expect((await exchangeMcpToken(tokenRequest(refresh))).status).toBe(400);
    expect(consumeMcpRefreshToken).not.toHaveBeenCalled();
    expect(saveMcpRefreshToken).not.toHaveBeenCalled();
  });
  it("refuses saved refresh scopes exceeding the parent grant", async () => {
    vi.mocked(getMcpRefreshToken).mockResolvedValue({
      grant_id: id,
      expires_at: new Date(Date.now() + 60000),
      scopes: ["profile:read", "media:read"],
      consumed_at: null,
    });
    vi.mocked(consumeMcpRefreshToken).mockResolvedValue(true);
    const refresh = {
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: "old",
      resource: query.resource,
    };
    expect((await exchangeMcpToken(tokenRequest(refresh))).status).toBe(400);
    expect(saveMcpRefreshToken).not.toHaveBeenCalled();
  });
});
