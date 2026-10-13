// @vitest-environment node
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpGrant, revokeMcpGrant } from "@/db/mcp-grants";
import { refreshAccessToken } from "@/lib/google";
import {
  authenticateMcpRequest,
  decryptMcpSecret,
  encryptMcpSecret,
  getMcpGoogleAccessToken,
  issueMcpAccessToken,
} from "./auth";

vi.mock("@/db/mcp-grants", () => ({
  getMcpGrant: vi.fn(),
  revokeMcpGrant: vi.fn(),
  updateMcpGoogleCredential: vi.fn(),
}));
vi.mock("@/lib/google", () => ({
  refreshAccessToken: vi.fn(),
  hasGoogleDriveScope: (scope: string) => scope.includes("drive.file"),
}));
const id = "11111111-1111-4111-8111-111111111111";
const profile = {
  id: "google-sub",
  email: "user@example.test",
  name: null,
  picture: null,
};
const principal = {
  googleUserId: profile.id,
  grantId: id,
  profile,
  scopes: ["profile:read"],
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
function request(token?: string) {
  return new Request("https://drivebeats.example/mcp", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats.example");
  vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
  vi.stubEnv(
    "MCP_CLIENT_REDIRECT_URIS",
    "https://chatgpt.com/connector_platform_oauth_redirect",
  );
  vi.stubEnv(
    "MCP_ACCESS_TOKEN_SIGNING_KEY",
    Buffer.alloc(32, 1).toString("base64url"),
  );
  vi.stubEnv(
    "MCP_CREDENTIAL_ENCRYPTION_KEY",
    Buffer.alloc(32, 2).toString("base64url"),
  );
  vi.mocked(getMcpGrant).mockResolvedValue(grant);
});
describe("MCP grant verification", () => {
  it("accepts an owned token without website cookies", async () => {
    expect(
      await authenticateMcpRequest(
        request(await issueMcpAccessToken(principal)),
        ["profile:read"],
      ),
    ).toEqual(principal);
  });
  it("rejects signed out and malformed tokens", async () => {
    await expect(authenticateMcpRequest(request())).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      authenticateMcpRequest(request("bogus")),
    ).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    { aud: "https://elsewhere.example/mcp" },
    { iss: "https://elsewhere.example" },
    { exp: 1 },
    { sub: "another-account" },
  ])("rejects changed audience/issuer/expiry/ownership %j", async (changed) => {
    const token = await new SignJWT({ grant_id: id, scope: "profile:read" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setIssuer(changed.iss ?? "https://drivebeats.example")
      .setAudience(changed.aud ?? "https://drivebeats.example/mcp")
      .setSubject(changed.sub ?? profile.id)
      .setIssuedAt()
      .setExpirationTime(changed.exp ?? "15m")
      .sign(Buffer.alloc(32, 1));
    await expect(authenticateMcpRequest(request(token))).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects insufficient scopes", async () => {
    await expect(
      authenticateMcpRequest(request(await issueMcpAccessToken(principal)), [
        "media:read",
      ]),
    ).rejects.toMatchObject({ status: 403, code: "insufficient_scope" });
  });
  it("rejects revoked or expired grants", async () => {
    const token = await issueMcpAccessToken(principal);
    for (const changed of [
      { revokedAt: new Date() },
      { expiresAt: new Date(1) },
    ]) {
      vi.mocked(getMcpGrant).mockResolvedValue({ ...grant, ...changed });
      await expect(
        authenticateMcpRequest(request(token)),
      ).rejects.toMatchObject({ status: 401 });
    }
  });
  it("rejects divergent profile identity before service reads", async () => {
    vi.mocked(getMcpGrant).mockResolvedValue({
      ...grant,
      profile: { ...profile, id: "another" },
    });
    await expect(
      authenticateMcpRequest(request(await issueMcpAccessToken(principal))),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("binds encrypted provider credentials to their grant", async () => {
    const encrypted = await encryptMcpSecret(
      { token: "provider-secret" },
      `google:${id}`,
    );
    expect(encrypted).not.toContain("provider-secret");
    await expect(decryptMcpSecret(encrypted, "google:other")).rejects.toThrow();
  });
  it("refreshes Google only on server and revokes invalid provider grants", async () => {
    vi.mocked(getMcpGrant).mockResolvedValue({
      ...grant,
      encryptedGoogleRefreshToken: await encryptMcpSecret(
        { token: "provider-secret" },
        `google:${id}`,
      ),
    });
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: "access",
      expires_in: 3600,
      scope: "drive.file",
    });
    expect(await getMcpGoogleAccessToken(principal)).toBe("access");
    vi.mocked(refreshAccessToken).mockResolvedValue({ error: "invalid_grant" });
    await expect(getMcpGoogleAccessToken(principal)).rejects.toMatchObject({
      status: 401,
    });
    expect(revokeMcpGrant).toHaveBeenCalledWith(id, profile.id);
  });
});
