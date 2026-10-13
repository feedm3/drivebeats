import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { registerMusicTools } from "./music-tools";
import { registerPrivateTools } from "./private-tools";
import { readUiResource, UI_MIME_TYPE } from "./ui-resource";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createDrivebeatsMcpHandler(loadUi = readUiResource) {
  const handler = createMcpHandler(
    async (context) => {
      const ui = await loadUi(context.requestInfo);
      const server = new McpServer(
        { name: "drivebeats", version: "0.1.0" },
        {
          capabilities: { tools: {}, resources: {} },
          instructions:
            "DriveBeats plays user-selected Google Drive audio. Connect your account and import folders or tracks in the player. Library search, playback and temporary queues target one active session; saved Playlists and favorites sync with the website. Reuse operation IDs on retries. Google Drive is strictly read-only.",
        },
      );

      server.registerResource(
        "drivebeats-player",
        ui.uri,
        {
          title: "DriveBeats",
          description:
            "Browse your imported Library and listen to your Playable Tracks.",
          mimeType: UI_MIME_TYPE,
          _meta: {
            ui: {
              csp: { connectDomains: [], resourceDomains: ui.resourceDomains },
              prefersBorder: false,
            },
          },
        },
        async () => ({
          contents: [
            {
              uri: ui.uri,
              mimeType: UI_MIME_TYPE,
              text: ui.html,
              _meta: {
                ui: {
                  csp: {
                    connectDomains: [],
                    resourceDomains: ui.resourceDomains,
                  },
                  prefersBorder: false,
                },
              },
            },
          ],
        }),
      );

      server.registerTool(
        "drivebeats_open_player",
        {
          title: "DriveBeats",
          description:
            "Open DriveBeats to connect your account, import your Library and play your selected Google Drive audio.",
          inputSchema: z.strictObject({}),
          annotations: readOnlyAnnotations,
          _meta: {
            ui: { resourceUri: ui.uri },
            "openai/ui": { entrypoints: [{ type: "global" }] },
            securitySchemes: [{ type: "noauth" }],
          },
        },
        async () => ({
          content: [
            {
              type: "text" as const,
              text: "Open DriveBeats, connect your account and import your Library. Select Play to enable audio.",
            },
          ],
          structuredContent: { status: "ready" },
        }),
      );

      registerPrivateTools(server, context.requestInfo, ui.uri);
      registerMusicTools(server, context.requestInfo);

      return server;
    },
    { legacy: "stateless", maxRequestBodySize: 128 * 1024 },
  );
  return {
    ...handler,
    async fetch(...args: Parameters<typeof handler.fetch>) {
      const request = args[0];
      const legacyRequest =
        request.method === "POST" && !request.headers.has("Mcp-Method")
          ? request.clone()
          : undefined;
      const response = await handler.fetch(...args);
      if (!response.ok) return response;
      // Installed desktop clients still use the 2025 handshake and omit the
      // modern method header. Read the clone only after SDK body validation.
      const method =
        request.headers.get("Mcp-Method") ??
        (await legacyRequest?.json().catch(() => undefined))?.method;
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !["tools/list", "server/discover"].includes(method) ||
        !["application/json", "text/event-stream"].some((type) =>
          contentType.includes(type),
        )
      )
        return response;
      // SDK 2.3.1 omits extension fields from registerTool. Publish the OpenAI
      // auth declaration for both protocol eras and retain its metadata mirror.
      const mirrorSchemes = (envelope: {
        result?: {
          tools?: Array<{
            _meta?: { securitySchemes?: unknown[] };
            securitySchemes?: unknown[];
          }>;
        };
      }) => {
        if (Array.isArray(envelope.result?.tools)) {
          for (const tool of envelope.result.tools) {
            if (Array.isArray(tool._meta?.securitySchemes))
              tool.securitySchemes = tool._meta.securitySchemes;
          }
        }
        return JSON.stringify(envelope);
      };
      const body = contentType.includes("application/json")
        ? mirrorSchemes(await response.json())
        : (await response.text()).replace(
            /^data: (.+)$/gm,
            (_, data) => `data: ${mirrorSchemes(JSON.parse(data))}`,
          );
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

export const drivebeatsMcpHandler = createDrivebeatsMcpHandler();
