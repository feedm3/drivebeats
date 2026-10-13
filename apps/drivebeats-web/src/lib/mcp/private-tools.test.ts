// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeMcpGrant } from "@/db/mcp-grants";
import { getCloudLibrarySyncPayload } from "@/lib/cloud-library-service";
import {
  authenticateMcpRequest,
  McpAuthError,
  type McpPrincipal,
} from "./auth";
import { prepareMcpMedia } from "./media-service";
import { createDrivebeatsMcpHandler } from "./server";
import { createUiResource } from "./ui-resource";

vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  authenticateMcpRequest: vi.fn(),
}));
vi.mock("./media-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media-service")>()),
  prepareMcpMedia: vi.fn(),
}));
vi.mock("@/db/mcp-grants", () => ({
  revokeMcpGrant: vi.fn(),
  getMcpGrant: vi.fn(),
  updateMcpGoogleCredential: vi.fn(),
}));
vi.mock("@/lib/cloud-library-service", () => ({
  getCloudLibrarySyncPayload: vi.fn(),
}));

const principal: McpPrincipal = {
  googleUserId: "a",
  grantId: "grant-a",
  profile: {
    id: "a",
    email: "a@example.com",
    name: "Account A",
    picture: null,
  },
  scopes: ["profile:read", "library:read", "media:read"],
};
const handlers: ReturnType<typeof createDrivebeatsMcpHandler>[] = [];
function createHandler() {
  const handler = createDrivebeatsMcpHandler(async () =>
    createUiResource("<html>Player</html>"),
  );
  handlers.push(handler);
  return handler;
}
function request(
  method: string,
  name?: string,
  args: Record<string, unknown> = {},
) {
  return new Request("https://drivebeats.app/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
      Authorization: "Bearer drivebeats-token",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...(name ? { name, arguments: args } : {}),
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats.app");
  vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
  vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", "https://chatgpt.com/callback");
  vi.mocked(authenticateMcpRequest).mockResolvedValue(principal);
  vi.mocked(getCloudLibrarySyncPayload).mockResolvedValue({
    playlists: [],
    favorites: [],
  });
});
afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  vi.unstubAllEnvs();
});

describe("Private MCP tool contracts", () => {
  it.each([
    ["invalid_token", 401],
    ["insufficient_scope", 403],
  ] as const)(
    "requests the full account baseline for %s while enforcing each tool's minimum scope",
    async (code, status) => {
      vi.mocked(authenticateMcpRequest).mockRejectedValue(
        new McpAuthError(code, status),
      );
      const handler = createHandler();
      for (const [name, required] of [
        ["drivebeats_get_profile", "profile:read"],
        ["drivebeats_get_cloud_library", "library:read"],
        ["drivebeats_prepare_media", "media:read"],
      ]) {
        const { result } = await (
          await handler.fetch(
            request(
              "tools/call",
              name,
              name === "drivebeats_prepare_media" ? { fileId: "selected" } : {},
            ),
          )
        ).json();
        expect(authenticateMcpRequest).toHaveBeenLastCalledWith(
          expect.any(Request),
          [required],
        );
        expect(result.isError).toBe(true);
        expect(result._meta["mcp/www_authenticate"][0]).toContain(
          'scope="profile:read library:read media:read"',
        );
      }
      expect(getCloudLibrarySyncPayload).not.toHaveBeenCalled();
      expect(prepareMcpMedia).not.toHaveBeenCalled();
    },
  );
  it("requires the full baseline for the app's deliberate Connect action", async () => {
    vi.mocked(authenticateMcpRequest).mockRejectedValueOnce(new McpAuthError());
    const { result } = await (
      await createHandler().fetch(
        request("tools/call", "drivebeats_connect_account"),
      )
    ).json();
    expect(authenticateMcpRequest).toHaveBeenCalledWith(expect.any(Request), [
      "profile:read",
      "library:read",
      "media:read",
    ]);
    expect(result._meta["mcp/www_authenticate"][0]).toContain(
      'scope="profile:read library:read media:read"',
    );
    const { result: discovery } = await (
      await createHandler().fetch(request("tools/list"))
    ).json();
    const tool = discovery.tools.find(
      (tool: { name: string }) => tool.name === "drivebeats_connect_account",
    );
    expect(tool._meta.ui.visibility).toEqual(["app"]);
    expect(tool._meta["openai/profile"]).toBeUndefined();
    expect(tool.securitySchemes).toEqual([
      {
        type: "oauth2",
        scopes: ["profile:read", "library:read", "media:read"],
      },
    ]);
  });
  it("keeps unconfigured anonymous private calls useful without leaking configuration", async () => {
    vi.stubEnv("MCP_AUTH_ISSUER", "");
    vi.mocked(authenticateMcpRequest).mockRejectedValue(new McpAuthError());
    const response = await createHandler().fetch(
      request("tools/call", "drivebeats_get_profile"),
    );
    const { result } = await response.json();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: "error",
      message: "Account linking is unavailable. Please try again later.",
    });
    expect(JSON.stringify(result)).not.toContain("MCP_AUTH_ISSUER");
  });
  it("publishes per-tool OAuth policies, stable-profile schema and app-only mutations", async () => {
    const response = await createHandler().fetch(request("tools/list"));
    const { result } = await response.json();
    const profile = result.tools.find(
      (tool: { name: string }) => tool.name === "drivebeats_get_profile",
    );
    expect(profile.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["profile:read"] },
    ]);
    expect(profile._meta["openai/profile"]).toBe(true);
    expect(profile.outputSchema.required).toEqual(["id"]);
    expect(profile.outputSchema.additionalProperties).toBe(false);
    expect(result.tools[0].securitySchemes).toEqual([{ type: "noauth" }]);
    const disconnect = result.tools.find(
      (tool: { name: string }) => tool.name === "drivebeats_disconnect",
    );
    expect(disconnect._meta.ui.visibility).toEqual(["app"]);
  });
  it("returns the credential-owned stable profile with compatible JSON text", async () => {
    const handler = createHandler();
    const { result } = await (
      await handler.fetch(request("tools/call", "drivebeats_get_profile"))
    ).json();
    expect(result.structuredContent).toEqual({
      id: "a",
      name: "Account A",
      email: "a@example.com",
    });
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent,
    );
    expect(authenticateMcpRequest).toHaveBeenCalledWith(expect.any(Request), [
      "profile:read",
    ]);
  });
  it.each([
    [401, "invalid_token", "sign_in_required"],
    [403, "insufficient_scope", "scope_required"],
  ] as const)(
    "challenges %s failures without private reads",
    async (status, code, state) => {
      vi.mocked(authenticateMcpRequest).mockRejectedValue(
        new McpAuthError(code, status),
      );
      for (const name of [
        "drivebeats_get_profile",
        "drivebeats_get_cloud_library",
        "drivebeats_prepare_media",
        "drivebeats_disconnect",
      ]) {
        const { result } = await (
          await createHandler().fetch(
            request(
              "tools/call",
              name,
              name === "drivebeats_prepare_media" ? { fileId: "a" } : {},
            ),
          )
        ).json();
        expect(result.isError).toBe(true);
        expect(result.structuredContent.status).toBe(state);
        expect(result._meta["mcp/www_authenticate"][0]).toContain(
          `error="${code}"`,
        );
        expect(result._meta["mcp/www_authenticate"][0]).toContain(
          'error_description="',
        );
        expect(result._meta["mcp/www_authenticate"][0]).toContain(
          'resource_metadata="https://drivebeats.app/.well-known/oauth-protected-resource/mcp"',
        );
      }
      expect(getCloudLibrarySyncPayload).not.toHaveBeenCalled();
      expect(prepareMcpMedia).not.toHaveBeenCalled();
      expect(revokeMcpGrant).not.toHaveBeenCalled();
    },
  );
  it("uses only verified identity for cloud reads and revokes only the current grant", async () => {
    const handler = createHandler();
    await handler.fetch(request("tools/call", "drivebeats_get_cloud_library"));
    expect(getCloudLibrarySyncPayload).toHaveBeenCalledWith(principal.profile);
    const { result } = await (
      await handler.fetch(request("tools/call", "drivebeats_disconnect"))
    ).json();
    expect(result.structuredContent).toEqual({ status: "disconnected" });
    expect(revokeMcpGrant).toHaveBeenCalledWith("grant-a", "a");
  });
  it("rejects model-supplied identity and keeps capabilities out of model-visible results", async () => {
    const handler = createHandler();
    const invalid = await (
      await handler.fetch(
        request("tools/call", "drivebeats_get_cloud_library", {
          googleUserId: "b",
        }),
      )
    ).json();
    expect(invalid.error || invalid.result?.isError).toBeTruthy();
    expect(authenticateMcpRequest).not.toHaveBeenCalled();
    vi.mocked(prepareMcpMedia).mockResolvedValue({
      fileId: "a",
      fileName: "a.mp3",
      mimeType: "audio/mpeg",
      expiresAt: "2030-01-01T00:00:00.000Z",
      mediaUrl: "https://drivebeats.app/api/mcp/media/secret-capability",
    });
    const { result } = await (
      await handler.fetch(
        request("tools/call", "drivebeats_prepare_media", { fileId: "a" }),
      )
    ).json();
    expect(result.structuredContent.status).toBe("ready");
    expect(
      JSON.stringify([result.content, result.structuredContent]),
    ).not.toContain("secret-capability");
    expect(result._meta.mediaUrl).toContain("secret-capability");
    expect(prepareMcpMedia).toHaveBeenCalledWith(principal, "a");
  });
});
