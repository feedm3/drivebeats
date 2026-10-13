import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { revokeMcpGrant } from "@/db/mcp-grants";
import { getCloudLibrarySyncPayload } from "@/lib/cloud-library-service";
import {
  authenticateMcpRequest,
  getMcpAuthChallenge,
  MCP_SCOPES,
  McpAuthError,
  type McpPrincipal,
} from "./auth";
import { McpMediaError, prepareMcpMedia } from "./media-service";
import { createMcpMusicImport } from "./music-session-service";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function textResult(structuredContent: Record<string, unknown>, text: string) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export function privateToolFailure(error: unknown) {
  if (error instanceof McpAuthError) {
    let challenge: string;
    try {
      // The installed host replaces operation-specific grants instead of
      // accumulating their scopes. Reconnection asks for the full account
      // baseline shown on the consent page; each tool still enforces its own
      // minimum scope and no existing grant gains additional permissions.
      challenge = getMcpAuthChallenge();
    } catch {
      return {
        ...textResult(
          {
            status: "error",
            message: "Account linking is unavailable. Please try again later.",
          },
          "Account linking is unavailable. Please try again later.",
        ),
        isError: true,
      };
    }
    const status = error.status === 403 ? "scope_required" : "sign_in_required";
    const message =
      error.status === 403
        ? "Reconnect DriveBeats to grant the requested access."
        : "Connect your DriveBeats account to continue.";
    return {
      ...textResult({ status, message }, message),
      isError: true,
      _meta: {
        "mcp/www_authenticate": [
          `${challenge}, error="${error.code}", error_description="${message}"`,
        ],
      },
    };
  }
  const message =
    error instanceof McpMediaError
      ? error.message
      : "DriveBeats is unavailable. Please try again.";
  return {
    ...textResult({ status: "error", message }, message),
    isError: true,
  };
}

export function registerPrivateTools(
  server: McpServer,
  request?: Request,
  resourceUri?: string,
) {
  function protectedOperation(
    scopes: string[],
    operation: (
      principal: McpPrincipal,
    ) => Promise<
      ReturnType<typeof textResult> & { _meta?: Record<string, unknown> }
    >,
  ) {
    return async () => {
      try {
        if (!request) throw new McpAuthError("invalid_token", 401);
        const principal = await authenticateMcpRequest(request, scopes);
        return await operation(principal);
      } catch (error) {
        return privateToolFailure(error);
      }
    };
  }
  function metadata(scopes: string[], appOnly = false) {
    return {
      securitySchemes: [{ type: "oauth2", scopes }],
      ...(appOnly && resourceUri
        ? { ui: { resourceUri, visibility: ["app"] } }
        : {}),
    };
  }

  const profileSchema = z.strictObject({
    id: z.string().min(1).regex(/\S/),
    name: z.string().optional(),
    email: z.string().optional(),
    nickname: z.string().optional(),
  });
  const profileResult = async (principal: McpPrincipal) => {
    const profile = {
      id: principal.profile.id,
      email: principal.profile.email,
      ...(principal.profile.name ? { name: principal.profile.name } : {}),
    };
    return textResult(profile, JSON.stringify(profile));
  };

  server.registerTool(
    "drivebeats_get_profile",
    {
      title: "Get DriveBeats account",
      description:
        "Connect DriveBeats and read the verified account identity shared with the website.",
      inputSchema: z.strictObject({}),
      outputSchema: profileSchema,
      annotations: readOnly,
      _meta: { ...metadata(["profile:read"]), "openai/profile": true },
    },
    protectedOperation(["profile:read"], profileResult),
  );

  server.registerTool(
    "drivebeats_connect_account",
    {
      title: "Connect DriveBeats account",
      description:
        "Connect your account to browse and play selected music, save requested Playlists and update favorites. Called when you choose Connect in DriveBeats.",
      inputSchema: z.strictObject({}),
      outputSchema: profileSchema,
      annotations: readOnly,
      _meta: metadata([...MCP_SCOPES], true),
    },
    protectedOperation([...MCP_SCOPES], profileResult),
  );

  server.registerTool(
    "drivebeats_get_cloud_library",
    {
      title: "Read synced Playlists and favorites",
      description:
        "Read your existing DriveBeats cloud Playlists, favorites and their ID3 metadata. The full device-local Library is not included.",
      inputSchema: z.strictObject({}),
      annotations: readOnly,
      _meta: metadata(["library:read"]),
    },
    protectedOperation(["library:read"], async (principal) => {
      const library = await getCloudLibrarySyncPayload(principal.profile);
      return {
        ...textResult(
          { status: "connected", ...library },
          `${library.playlists.length} synced Playlists and ${library.favorites.length} favorites.`,
        ),
        _meta: { accountId: principal.profile.id },
      };
    }),
  );

  server.registerTool(
    "drivebeats_prepare_media",
    {
      title: "Prepare a selected Playable Track",
      description:
        "Prepare a short-lived read of a Playable Track in your imported Library or synced collections. Audio requires an enabled player.",
      inputSchema: z.strictObject({
        fileId: z.string().min(1).max(256),
        sessionId: z.uuid().optional(),
      }),
      annotations: { ...readOnly, idempotentHint: false, openWorldHint: true },
      _meta: metadata(["media:read"], true),
    },
    async ({ fileId, sessionId }) =>
      protectedOperation(["media:read"], async (principal) => {
        const { mediaUrl, ...track } = await prepareMcpMedia(
          principal,
          fileId,
          sessionId,
        );
        return {
          ...textResult(
            { status: "ready", ...track },
            `Ready to play ${track.fileName}. Select Play in DriveBeats.`,
          ),
          _meta: { mediaUrl },
        };
      })(),
  );

  server.registerTool(
    "drivebeats_prepare_import",
    {
      title: "Choose music to import",
      description:
        "Open Google Picker on DriveBeats to deliberately select Imported Folders or Standalone Tracks for this player. Google Drive stays read-only.",
      inputSchema: z.strictObject({ sessionId: z.uuid() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: metadata(["library:read"], true),
    },
    async ({ sessionId }) =>
      protectedOperation(["library:read"], async (principal) => {
        const selection = await createMcpMusicImport(principal, sessionId);
        return {
          ...textResult(
            { status: "ready", expiresAt: selection.expiresAt },
            "Choose music on DriveBeats, then return to this player.",
          ),
          _meta: { importUrl: selection.url },
        };
      })(),
  );

  server.registerTool(
    "drivebeats_disconnect",
    {
      title: "Disconnect DriveBeats",
      description:
        "Revoke this plugin's account grant and media access. Saved cloud Playlists and favorites are retained.",
      inputSchema: z.strictObject({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: metadata(["profile:read"], true),
    },
    protectedOperation(["profile:read"], async (principal) => {
      await revokeMcpGrant(principal.grantId, principal.googleUserId);
      return textResult(
        { status: "disconnected" },
        "DriveBeats disconnected. Your saved Playlists and favorites are retained.",
      );
    }),
  );
}
