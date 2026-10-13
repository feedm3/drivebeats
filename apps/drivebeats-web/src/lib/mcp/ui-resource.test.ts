// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrivebeatsMcpHandler } from "./server";
import { readUiResource, renderUiResource } from "./ui-resource";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

const artifactPath = join(process.cwd(), ".mcp-ui", "index.html");
const missingArtifact = Object.assign(
  new Error(`ENOENT: no such file or directory, open '${artifactPath}'`),
  { code: "ENOENT", path: artifactPath },
);
const template = `<html><head><script type="module">startPlayer()</script></head></html>`;

beforeEach(() => {
  vi.stubEnv("MCP_AUTH_ISSUER", "");
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockRejectedValue(missingArtifact);
});
afterEach(() => vi.unstubAllEnvs());

describe("production player HTML", () => {
  it("injects the independent canonical media origin and permits only its exact origin without sample assets", async () => {
    vi.stubEnv("VERCEL_URL", "player-preview.vercel.app");
    vi.stubEnv("MCP_AUTH_ISSUER", "https://www.drivebeats.app");
    vi.mocked(readFile).mockResolvedValue(template);
    const ui = await readUiResource(
      new Request("https://player-preview.vercel.app/mcp"),
    );
    expect(ui.html).toContain(
      '<script id="drivebeats-media-read" type="application/json">{"origin":"https://www.drivebeats.app"}</script>',
    );
    expect(ui.html).toContain('"origin":"https://www.drivebeats.app"');
    expect(ui.resourceDomains).toEqual(["https://www.drivebeats.app"]);
    expect(ui.uri).not.toBe(
      renderUiResource(template, "https://player-preview.vercel.app").uri,
    );
  });
  it("disables private media when unconfigured and rejects unsafe media origins", () => {
    expect(
      renderUiResource(template, "https://preview.example").html,
    ).toContain(
      'id="drivebeats-media-read" type="application/json">{"origin":null}',
    );
    for (const issuer of [
      "http://localhost:3100",
      "https://host.example/path",
      "https://user:secret@host.example",
      "https://host.example?token=secret",
    ]) {
      expect(() =>
        renderUiResource(template, "https://preview.example", issuer),
      ).toThrow();
    }
  });
  it("uses the fixed Vercel origin, hashes the rendered bytes, and declares the same CSP origin", async () => {
    vi.stubEnv("VERCEL_URL", "player-preview.vercel.app");
    vi.mocked(readFile).mockResolvedValue(template);
    const ui = await readUiResource(new Request("http://localhost:3101/mcp"));
    expect(ui.html).toContain('"origin":"https://www.drivebeats.app"');
    expect(ui.html).not.toContain("__DRIVEBEATS_FIXTURE_ORIGIN__");
    const hash = createHash("sha256").update(ui.html).digest("hex");
    expect(ui.uri).toBe(`ui://drivebeats/player-${hash}.html`);
    expect(ui.resourceDomains).toEqual([]);
    expect(ui.uri).toBe(
      renderUiResource(template, "https://another-preview.vercel.app").uri,
    );
  });

  it("uses the validated local request origin when no Vercel URL is configured", async () => {
    vi.stubEnv("VERCEL_URL", "");
    vi.mocked(readFile).mockResolvedValue(template);
    const ui = await readUiResource(new Request("http://localhost:3101/mcp"));
    expect(ui.html).toContain('"origin":null');
    expect(ui.resourceDomains).toEqual([]);
  });

  it.each([
    "http://remote.example",
    "https://preview.example/path",
    "https://user:password@preview.example",
    "https://preview.example?token=secret",
  ])("rejects unsafe or non-origin URL injection: %s", (origin) => {
    expect(() => renderUiResource(template, origin)).toThrow();
  });

  it("rejects an artifact that is missing the head element", () => {
    expect(() =>
      renderUiResource("<html></html>", "https://preview.example"),
    ).toThrow("missing its head element");
  });
});

describe("MCP UI deployment artifact failures", () => {
  it("fails when the packaged bundle is absent without reading a fallback location", async () => {
    await expect(readUiResource()).rejects.toMatchObject({ code: "ENOENT" });
    expect(readFile).toHaveBeenCalledExactlyOnceWith(artifactPath, "utf8");
  });

  it("returns a JSON-RPC server error without leaking the bundle path or stack", async () => {
    const handler = createDrivebeatsMcpHandler(readUiResource);
    try {
      const response = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": "2026-07-28",
            "Mcp-Method": "resources/read",
            "Mcp-Name": "ui://drivebeats/unavailable.html",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "resources/read",
            params: {
              uri: "ui://drivebeats/unavailable.html",
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {
                  name: "drivebeats-artifact-test",
                  version: "1.0.0",
                },
              },
            },
          }),
        }),
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json",
      );
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Internal server error" },
      });
      expect(body).not.toContain(artifactPath);
      expect(body).not.toContain("ENOENT");
      expect(body).not.toContain("stack");
      expect(readFile).toHaveBeenCalledTimes(1);
    } finally {
      await handler.close();
    }
  });
});
