// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrivebeatsMcpHandler } from "./server";
import {
  createUiResource,
  renderUiResource,
  UI_MIME_TYPE,
} from "./ui-resource";

const handlers: ReturnType<typeof createDrivebeatsMcpHandler>[] = [];

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  vi.unstubAllEnvs();
});

function buildHandler(html = "<html><body>Fixture player</body></html>") {
  const handler = createDrivebeatsMcpHandler(async () =>
    createUiResource(html),
  );
  handlers.push(handler);
  return handler;
}

function modernRequest(method: string, params: Record<string, unknown> = {}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
  });
  const name = params.name ?? params.uri;
  if (typeof name === "string") headers.set("Mcp-Name", name);
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "drivebeats-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

function legacyRequest(method: string, params: Record<string, unknown> = {}) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function readLegacyResult(response: Response) {
  expect(response.status).toBe(200);
  if (response.headers.get("content-type")?.includes("application/json"))
    return response.json();
  const body = await response.text();
  const event = body.split("\n").find((line) => line.startsWith("data: "));
  expect(event).toBeDefined();
  return JSON.parse(event?.slice(6) ?? "");
}

describe("DriveBeats modern MCP endpoint", () => {
  it("links the rendered HTML version and matching exact-origin media CSP in discovery and resource reads", async () => {
    const template =
      '<html><head><script id="drivebeats-fixture-audio" type="application/json">{"origin":"__DRIVEBEATS_FIXTURE_ORIGIN__"}</script></head></html>';
    const ui = renderUiResource(template, "https://preview.vercel.app");
    const handler = createDrivebeatsMcpHandler(async () => ui);
    handlers.push(handler);
    const { result: toolList } = await (
      await handler.fetch(modernRequest("tools/list"))
    ).json();
    const linkedUri = toolList.tools[0]._meta.ui.resourceUri;
    const { result: resources } = await (
      await handler.fetch(modernRequest("resources/list"))
    ).json();
    expect(resources.resources[0].uri).toBe(linkedUri);
    expect(resources.resources[0]._meta.ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: ["https://preview.vercel.app"],
    });
    const { result: resource } = await (
      await handler.fetch(modernRequest("resources/read", { uri: linkedUri }))
    ).json();
    expect(resource.contents[0].text).toBe(ui.html);
    expect(resource.contents[0]._meta.ui.csp).toEqual(
      resources.resources[0]._meta.ui.csp,
    );
  });
  it("discovers without initialization and exposes strict fixture tools and sidebar entrypoint", async () => {
    const handler = buildHandler();
    const discovery = await handler.fetch(modernRequest("server/discover"));
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get("Mcp-Session-Id")).toBeNull();
    const discoveryBody = await discovery.json();
    expect(discoveryBody.error).toBeUndefined();
    expect(JSON.stringify(discoveryBody.result)).toContain("2026-07-28");

    const response = await handler.fetch(modernRequest("tools/list"));
    const { result } = await response.json();
    expect(result.tools).toHaveLength(7);
    const launch = result.tools.find(
      (tool: { name: string }) =>
        tool.name === "drivebeats_open_fixture_player",
    );
    expect(launch.title).toBe("DriveBeats");
    expect(launch.inputSchema.additionalProperties).toBe(false);
    expect(launch._meta["openai/ui"].entrypoints).toEqual([{ type: "global" }]);
    expect(launch._meta.ui.resourceUri).toMatch(
      /^ui:\/\/drivebeats\/fixture-player-[a-f0-9]{64}\.html$/,
    );
    expect(launch.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("returns fixture data for both UI and model calls without account input", async () => {
    const handler = buildHandler();
    for (const name of [
      "drivebeats_open_fixture_player",
      "drivebeats_list_fixture_tracks",
    ]) {
      const response = await handler.fetch(
        modernRequest("tools/call", { name, arguments: {} }),
      );
      expect(response.status).toBe(200);
      const { result } = await response.json();
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.tracks).toHaveLength(2);
      expect(result.structuredContent.tracks[0]).toMatchObject({
        id: "pulse",
        title: "Pulse",
        durationSeconds: 6,
      });
      expect(result.content[0].text).toContain("Select Play");
      expect(JSON.stringify(result)).not.toMatch(/access_token|drive\.google/);
    }
  });

  it("reads the linked UI as a versioned MCP App resource with no remote CSP access", async () => {
    const html =
      "<html><body><script>console.log('fixture')</script></body></html>";
    const handler = buildHandler(html);
    const listed = await handler.fetch(modernRequest("resources/list"));
    const { result: resources } = await listed.json();
    const uri = resources.resources[0].uri;
    const response = await handler.fetch(
      modernRequest("resources/read", { uri }),
    );
    const { result } = await response.json();
    expect(result.contents[0]).toMatchObject({
      uri,
      mimeType: UI_MIME_TYPE,
      text: html,
      _meta: {
        ui: { csp: { connectDomains: [], resourceDomains: [] } },
      },
    });
    expect(createUiResource(`${html} `).uri).not.toBe(uri);
  });

  it("rejects model-supplied user IDs and unknown tools/resources", async () => {
    const handler = buildHandler();
    const invalid = await handler.fetch(
      modernRequest("tools/call", {
        name: "drivebeats_list_fixture_tracks",
        arguments: { userId: "arbitrary-user", trackId: "private-track" },
      }),
    );
    const invalidBody = await invalid.json();
    expect(invalidBody.result?.isError || invalidBody.error).toBeTruthy();
    expect(invalidBody.result?.structuredContent).toBeUndefined();

    const unknownTool = await handler.fetch(
      modernRequest("tools/call", { name: "delete_drive_file", arguments: {} }),
    );
    expect((await unknownTool.json()).error).toBeDefined();
    const unknownResource = await handler.fetch(
      modernRequest("resources/read", { uri: "ui://drivebeats/missing.html" }),
    );
    expect((await unknownResource.json()).error).toBeDefined();
  });

  it("supports the installed desktop client's 2025 handshake and anonymous discovery without dropping OAuth schemes", async () => {
    vi.stubEnv("MCP_AUTH_ISSUER", "https://drivebeats.example");
    vi.stubEnv("MCP_CLIENT_ID", "drivebeats-chatgpt-preview");
    vi.stubEnv("MCP_CLIENT_REDIRECT_URIS", "https://chatgpt.com/callback");
    const handler = buildHandler();
    const initialized = await readLegacyResult(
      await handler.fetch(
        legacyRequest("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "codex-desktop", version: "0.162.0" },
        }),
      ),
    );
    expect(initialized.error).toBeUndefined();
    expect(initialized.result.protocolVersion).toBe("2025-06-18");
    const listed = await readLegacyResult(
      await handler.fetch(legacyRequest("tools/list")),
    );
    expect(listed.result.tools).toHaveLength(7);
    expect(
      listed.result.tools.find(
        (tool: { name: string }) =>
          tool.name === "drivebeats_open_fixture_player",
      ).title,
    ).toBe("DriveBeats");
    expect(listed.result.tools[0].securitySchemes).toEqual([
      { type: "noauth" },
    ]);
    const profile = listed.result.tools.find(
      (tool: { name: string }) => tool.name === "drivebeats_get_profile",
    );
    expect(profile.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["profile:read"] },
    ]);
    expect(profile._meta.securitySchemes).toEqual(profile.securitySchemes);
    const fixture = await readLegacyResult(
      await handler.fetch(
        legacyRequest("tools/call", {
          name: "drivebeats_list_fixture_tracks",
          arguments: {},
        }),
      ),
    );
    expect(fixture.result.structuredContent.tracks).toHaveLength(2);
    const unauthenticated = await readLegacyResult(
      await handler.fetch(
        legacyRequest("tools/call", {
          name: "drivebeats_get_profile",
          arguments: {},
        }),
      ),
    );
    expect(unauthenticated.result.isError).toBe(true);
    expect(unauthenticated.result._meta["mcp/www_authenticate"][0]).toContain(
      'scope="profile:read"',
    );
  });

  it("fails malformed or mismatched modern requests", async () => {
    const handler = buildHandler();
    const mismatch = modernRequest("tools/list");
    mismatch.headers.set("Mcp-Method", "tools/call");
    const response = await handler.fetch(mismatch);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeDefined();

    const malformed = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
  });

  it("bounds request bodies before any server construction", async () => {
    const handler = buildHandler();
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: " ".repeat(16 * 1024 + 1),
      }),
    );
    expect(response.status).toBe(413);
  });
});
