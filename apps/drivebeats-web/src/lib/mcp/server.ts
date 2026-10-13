import { FIXTURE_TRACKS } from "@drivebeats/mcp-app/fixtures";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { registerPrivateTools } from "./private-tools";
import { readUiResource, UI_MIME_TYPE } from "./ui-resource";

const fixtureOutputSchema = z.object({
  tracks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      artist: z.string(),
      durationSeconds: z.number().positive(),
    }),
  ),
});

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
            "DriveBeats offers anonymous sample tracks. Connect your account to read your verified profile, synced Playlists and favorites. Private operations require a DriveBeats grant. Audio starts only from the user's player controls.",
        },
      );

      server.registerResource(
        "drivebeats-player",
        ui.uri,
        {
          title: "DriveBeats",
          description: "Listen to two original instrumental samples.",
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

      const fixtureResult = async () => ({
        content: [
          {
            type: "text" as const,
            text: `Sample tracks: ${FIXTURE_TRACKS.map(
              (track) =>
                `${track.title} by ${track.artist} (${track.durationSeconds} seconds)`,
            ).join("; ")}. Select Play in DriveBeats to listen.`,
          },
        ],
        structuredContent: { tracks: FIXTURE_TRACKS },
      });

      server.registerTool(
        "drivebeats_open_fixture_player",
        {
          title: "Open DriveBeats",
          description:
            "Open DriveBeats to listen to two sample tracks. This does not access a user's Library or Google Drive.",
          inputSchema: z.strictObject({}),
          outputSchema: fixtureOutputSchema,
          annotations: readOnlyAnnotations,
          _meta: {
            ui: { resourceUri: ui.uri },
            "openai/ui": { entrypoints: [{ type: "global" }] },
            securitySchemes: [{ type: "noauth" }],
          },
        },
        fixtureResult,
      );

      server.registerTool(
        "drivebeats_list_fixture_tracks",
        {
          title: "List sample tracks",
          description:
            "Read the two sample tracks available in DriveBeats. No private music or account data is available.",
          inputSchema: z.strictObject({}),
          outputSchema: fixtureOutputSchema,
          annotations: readOnlyAnnotations,
          _meta: { securitySchemes: [{ type: "noauth" }] },
        },
        fixtureResult,
      );

      registerPrivateTools(server, context.requestInfo, ui.uri);

      return server;
    },
    { legacy: "reject", maxRequestBodySize: 16 * 1024 },
  );
  return {
    ...handler,
    async fetch(...args: Parameters<typeof handler.fetch>) {
      const response = await handler.fetch(...args);
      if (
        !["tools/list", "server/discover"].includes(
          args[0].headers.get("Mcp-Method") ?? "",
        ) ||
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        return response;
      const envelope = await response.json();
      // SDK 2.3.1 omits extension fields from registerTool. Publish the OpenAI
      // auth declaration at the wire boundary and retain its metadata mirror.
      if (Array.isArray(envelope.result?.tools)) {
        for (const tool of envelope.result.tools) {
          if (Array.isArray(tool._meta?.securitySchemes))
            tool.securitySchemes = tool._meta.securitySchemes;
        }
      }
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify(envelope), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

export const drivebeatsMcpHandler = createDrivebeatsMcpHandler();
