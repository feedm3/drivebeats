// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpGrant } from "@/db/mcp-grants";
import { getMcpMediaGrant, insertMcpMediaGrant } from "@/db/mcp-media-grants";
import { getCloudLibrarySyncPayload } from "@/lib/cloud-library-service";
import { getMcpGoogleAccessToken, type McpPrincipal } from "./auth";
import { handleMcpMediaRequest, prepareMcpMedia } from "./media-service";

vi.mock("@/db/mcp-grants", () => ({ getMcpGrant: vi.fn() }));
vi.mock("@/db/mcp-media-grants", () => ({
  getMcpMediaGrant: vi.fn(),
  insertMcpMediaGrant: vi.fn(),
}));
vi.mock("@/lib/cloud-library-service", () => ({
  getCloudLibrarySyncPayload: vi.fn(),
}));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  getMcpGoogleAccessToken: vi.fn(),
}));

const principal: McpPrincipal = {
  googleUserId: "account-a",
  grantId: "grant-a",
  profile: {
    id: "account-a",
    email: "a@example.com",
    name: "A",
    picture: null,
  },
  scopes: ["media:read"],
};
const capability = "a".repeat(43);
const request = (headers?: HeadersInit) =>
  new Request(`https://drivebeats.app/api/mcp/media/${capability}`, {
    headers,
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats.app");
  vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
  vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", "https://chatgpt.com/callback");
  vi.mocked(getCloudLibrarySyncPayload).mockResolvedValue({
    playlists: [
      {
        id: "p-a",
        name: "A",
        tracks: [{ fileId: "track-a", fileName: "a.mp3" }],
      },
    ],
    favorites: [],
  });
  vi.mocked(getMcpGoogleAccessToken).mockResolvedValue("provider-secret");
  vi.mocked(getMcpMediaGrant).mockResolvedValue({
    capabilityHash: "hash",
    grantId: "grant-a",
    googleUserId: "account-a",
    fileId: "track-a",
    mimeType: "audio/mpeg",
    expiresAt: new Date(Date.now() + 300_000),
  });
  vi.mocked(getMcpGrant).mockResolvedValue({
    id: "grant-a",
    googleUserId: "account-a",
    clientId: "chatgpt",
    profile: principal.profile,
    scopes: ["media:read"],
    encryptedGoogleRefreshToken: "encrypted",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ id: "track-a", name: "a.mp3", mimeType: "audio/mpeg" }),
    ),
  );
});

describe("MCP selected media boundary", () => {
  it("checks account-selected membership before provider credentials or media are accessed", async () => {
    await expect(
      prepareMcpMedia(principal, "another-account-track"),
    ).rejects.toMatchObject({ status: 404 });
    expect(getCloudLibrarySyncPayload).toHaveBeenCalledWith(principal.profile);
    expect(getMcpGoogleAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(insertMcpMediaGrant).not.toHaveBeenCalled();
  });
  it("checks scope and verified subject consistency at the media service entry", async () => {
    await expect(
      prepareMcpMedia({ ...principal, scopes: [] }, "track-a"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      prepareMcpMedia({ ...principal, googleUserId: "account-b" }, "track-a"),
    ).rejects.toMatchObject({ status: 401 });
    expect(getCloudLibrarySyncPayload).not.toHaveBeenCalled();
  });
  it("issues an opaque capability stored as a hash without provider credentials", async () => {
    const result = await prepareMcpMedia(principal, "track-a");
    expect(result.mediaUrl).toMatch(
      /^https:\/\/drivebeats.app\/api\/mcp\/media\/[A-Za-z0-9_-]{43}$/,
    );
    expect(JSON.stringify(result)).not.toContain("provider-secret");
    const saved = vi.mocked(insertMcpMediaGrant).mock.calls[0][0];
    expect(saved.capabilityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.mediaUrl).not.toContain(saved.capabilityHash);
    expect(saved).toMatchObject({
      googleUserId: "account-a",
      grantId: "grant-a",
      fileId: "track-a",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });
  it.each([
    { id: "other", name: "a.mp3", mimeType: "audio/mpeg" },
    { id: "track-a", name: "a.mp3", mimeType: "audio/mpeg", trashed: true },
    { id: "track-a", name: "script.html", mimeType: "text/html" },
  ])(
    "rejects mismatched, removed and unsupported metadata %j",
    async (metadata) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(metadata));
      await expect(prepareMcpMedia(principal, "track-a")).rejects.toMatchObject(
        { status: 422 },
      );
      expect(insertMcpMediaGrant).not.toHaveBeenCalled();
    },
  );
  it("denies inaccessible selected files without exposing provider errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("provider-secret", { status: 403 }),
    );
    await expect(prepareMcpMedia(principal, "track-a")).rejects.toMatchObject({
      status: 404,
    });
    expect(insertMcpMediaGrant).not.toHaveBeenCalled();
  });
  it.each([
    "revoked",
    "expired",
    "account-mismatch",
    "profile-mismatch",
    "scope",
  ])("denies %s grants before streaming", async (kind) => {
    const grant = await getMcpGrant("grant-a");
    if (!grant) throw new Error("Missing test grant");
    if (kind === "revoked") grant.revokedAt = new Date();
    if (kind === "expired") grant.expiresAt = new Date(0);
    if (kind === "account-mismatch") grant.googleUserId = "account-b";
    if (kind === "profile-mismatch")
      grant.profile = { ...grant.profile, id: "account-b" };
    if (kind === "scope") grant.scopes = [];
    vi.mocked(getMcpGrant).mockResolvedValue(grant);
    const response = await handleMcpMediaRequest(request(), capability);
    expect(response.status).toBe(401);
    expect(getMcpGoogleAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies expired capabilities and membership removed after preparation", async () => {
    vi.mocked(getMcpMediaGrant).mockResolvedValueOnce(null);
    expect((await handleMcpMediaRequest(request(), capability)).status).toBe(
      404,
    );
    vi.mocked(getCloudLibrarySyncPayload).mockResolvedValueOnce({
      playlists: [],
      favorites: [],
    });
    expect((await handleMcpMediaRequest(request(), capability)).status).toBe(
      404,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refreshes server credentials and forwards a single range with an explicit response header allowlist", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("abc", {
        status: 206,
        headers: {
          "Content-Range": "bytes 0-2/20",
          "Content-Length": "3",
          "Accept-Ranges": "bytes",
          "Set-Cookie": "provider-secret",
          Location: "https://example.com/provider-secret",
        },
      }),
    );
    const response = await handleMcpMediaRequest(
      request({ Range: "bytes=0-2" }),
      capability,
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("abc");
    expect(response.headers.get("content-range")).toBe("bytes 0-2/20");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(getMcpGoogleAccessToken).toHaveBeenCalledWith(principal);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer provider-secret",
          Range: "bytes=0-2",
        },
      }),
    );
  });
  it("rejects multi-range requests and sanitizes provider/network failures", async () => {
    expect(
      (
        await handleMcpMediaRequest(
          request({ Range: "bytes=0-2,5-8" }),
          capability,
        )
      ).status,
    ).toBe(416);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("provider-secret"));
    const response = await handleMcpMediaRequest(request(), capability);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider-secret");
  });
});
