// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateMcpRequest, McpAuthError } from "./auth";
import { handleMcpRequest } from "./http";

vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  authenticateMcpRequest: vi.fn(),
}));

describe("MCP HTTP boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the validated canonical issuer alias and rejects forged origins", async () => {
    vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats-mcp-preview.example");
    vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
    vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", "https://chatgpt.com/callback");
    const fetch = vi.fn(async () => new Response("discovery"));
    const canonical = new Request(
      "https://drivebeats-mcp-preview.example/mcp",
      {
        headers: {
          Host: "drivebeats-mcp-preview.example",
          Origin: "https://drivebeats-mcp-preview.example",
        },
      },
    );
    expect((await handleMcpRequest(canonical, { fetch })).status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(canonical);
    fetch.mockClear();
    const forged = new Request(canonical.url, {
      headers: {
        Host: "drivebeats-mcp-preview.example",
        Origin: "https://attacker.example",
      },
    });
    expect((await handleMcpRequest(forged, { fetch })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://attacker.example",
    "https://attacker.example/path",
    "https://attacker.example/",
  ])("does not allow a hostname from an invalid issuer: %s", async (issuer) => {
    vi.stubEnv("MCP_AUTH_ISSUER", issuer);
    vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
    vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", "https://chatgpt.com/callback");
    const fetch = vi.fn();
    const response = await handleMcpRequest(
      new Request("https://attacker.example/mcp", {
        headers: { Host: "attacker.example" },
      }),
      { fetch },
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid Bearer credentials before SDK dispatch and retains discovery challenge", async () => {
    vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats.app");
    vi.stubEnv("MCP_CLIENT_ID", "chatgpt");
    vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", "https://chatgpt.com/callback");
    vi.mocked(authenticateMcpRequest).mockRejectedValueOnce(new McpAuthError());
    const fetch = vi.fn();
    const response = await handleMcpRequest(
      new Request("http://localhost/mcp", {
        headers: { Host: "localhost", Authorization: "Bearer invalid" },
      }),
      { fetch },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource/mcp",
    );
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="profile:read library:read library:write media:read"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("forwards non-browser local requests without reading their body", async () => {
    const request = new Request("http://localhost:3100/mcp", {
      method: "POST",
      headers: { Host: "localhost:3100" },
      body: "fixture request",
    });
    const fetch = vi.fn(
      async (forwarded: Request) => new Response(await forwarded.text()),
    );
    const response = await handleMcpRequest(request, { fetch });
    expect(await response.text()).toBe("fixture request");
    expect(fetch).toHaveBeenCalledWith(request);
  });

  const invalidHeaders: Record<string, string>[] = [
    { Host: "attacker.example" },
    { Host: "localhost:3100", Origin: "https://attacker.example" },
    { Host: "localhost:3100", Origin: "null" },
  ];
  it.each(invalidHeaders)(
    "rejects untrusted host/origin before tool dispatch: %j",
    async (headers) => {
      const fetch = vi.fn();
      const response = await handleMcpRequest(
        new Request("http://localhost:3100/mcp", {
          method: "POST",
          headers,
        }),
        { fetch },
      );
      expect(response.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
