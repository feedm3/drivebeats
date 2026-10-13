import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createPlaylistWithTracksRecord,
  getCloudLibrarySyncPayload,
  setFavoriteTrackRecord,
} from "@/lib/cloud-library-service";
import {
  getPlaylistLimitError,
  MAX_TRACKS_PER_PLAYLIST,
} from "@/lib/playlist-limits";
import {
  authenticateMcpRequest,
  McpAuthError,
  type McpPrincipal,
} from "./auth";
import {
  McpLibraryError,
  readMcpLibraryFolder,
  readMcpLibraryItem,
  validateImportedTrack,
  validateImportedTracks,
} from "./music-library-service";
import {
  acknowledgeMcpMusicCommand,
  closeMcpMusicSession,
  dispatchMcpMusicCommand,
  getMcpMusicSession,
  heartbeatMcpMusicSession,
  listMcpMusicSessions,
  McpMusicSessionError,
  openMcpMusicSession,
  pollMcpMusicSession,
  runMcpMusicOperation,
} from "./music-session-service";
import { privateToolFailure } from "./private-tools";

const sessionId = z.uuid();
const operationId = z
  .uuid()
  .describe(
    "Stable operation ID. Reuse it with identical arguments when retrying; a new ID means a new action.",
  );
const fileId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const pageToken = z.string().min(1).max(2048).optional();
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const action = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function registerMusicTools(server: McpServer, request?: Request) {
  function meta(scopes: string[], appOnly = false) {
    return {
      securitySchemes: [{ type: "oauth2", scopes }],
      ...(appOnly ? { ui: { visibility: ["app"] } } : {}),
    };
  }
  async function protectedCall(
    scopes: string[],
    operation: (principal: McpPrincipal) => Promise<Record<string, unknown>>,
  ) {
    try {
      if (!request) throw new McpAuthError();
      return result(
        await operation(await authenticateMcpRequest(request, scopes)),
      );
    } catch (error) {
      if (error instanceof McpMusicSessionError)
        return {
          ...result({
            status: error.status === 404 ? "unavailable" : "failed",
            message: error.message,
          }),
          isError: true,
        };
      const limit = getPlaylistLimitError(error);
      if (error instanceof McpLibraryError || limit) {
        const message = limit?.message ?? (error as Error).message;
        return { ...result({ status: "failed", message }), isError: true };
      }
      return privateToolFailure(error);
    }
  }

  server.registerTool(
    "drivebeats_open_session",
    {
      title: "Open player session",
      description:
        "Open an account-scoped, expiring player session. Called by the DriveBeats player.",
      inputSchema: z.strictObject({
        importReceipt: z.string().max(100_000).optional(),
      }),
      annotations: { ...action, idempotentHint: false },
      _meta: meta(["library:read"], true),
    },
    (input) =>
      protectedCall(["library:read"], (p) => openMcpMusicSession(p, input)),
  );
  server.registerTool(
    "drivebeats_heartbeat_session",
    {
      title: "Keep player session active",
      description:
        "Renew the active player and report whether the complete local Library catalog is ready.",
      inputSchema: z.strictObject({
        sessionId,
        catalogReady: z.boolean(),
        catalogRevision: z.number().int().nonnegative(),
      }),
      annotations: action,
      _meta: meta(["library:read"], true),
    },
    (input) =>
      protectedCall(["library:read"], (p) =>
        heartbeatMcpMusicSession(p, input),
      ),
  );
  server.registerTool(
    "drivebeats_poll_session",
    {
      title: "Read pending player action",
      description:
        "Claim the next pending action for this player. Commands expire and are never silently replayed.",
      inputSchema: z.strictObject({ sessionId }),
      annotations: action,
      _meta: meta(["library:read"], true),
    },
    ({ sessionId }) =>
      protectedCall(["library:read"], (p) => pollMcpMusicSession(p, sessionId)),
  );
  server.registerTool(
    "drivebeats_acknowledge_command",
    {
      title: "Acknowledge player action",
      description:
        "Report the actual outcome of a claimed action. Search results contain only bounded Library metadata.",
      inputSchema: z.strictObject({
        sessionId,
        operationId,
        claimToken: z.string().min(1).max(256),
        status: z.enum(["applied", "failed"]),
        result: z.record(z.string(), z.unknown()),
      }),
      annotations: action,
      _meta: meta(["library:read"], true),
    },
    (input) =>
      protectedCall(["library:read"], (p) =>
        acknowledgeMcpMusicCommand(p, input),
      ),
  );
  server.registerTool(
    "drivebeats_close_session",
    {
      title: "Close player session",
      description:
        "Close this device-local player, its imported Library bridge and pending commands. Synced collections are retained.",
      inputSchema: z.strictObject({ sessionId }),
      annotations: action,
      _meta: meta(["library:read"], true),
    },
    ({ sessionId }) =>
      protectedCall(["library:read"], async (p) => {
        await closeMcpMusicSession(p, sessionId);
        return { status: "closed" };
      }),
  );
  server.registerTool(
    "drivebeats_read_item",
    {
      title: "Read imported Library item",
      description:
        "Read provider metadata for an already imported Library item. Does not grant access to another Drive item.",
      inputSchema: z.strictObject({ sessionId, fileId }),
      annotations: { ...readOnly, openWorldHint: true },
      _meta: meta(["library:read"], true),
    },
    ({ sessionId, fileId }) =>
      protectedCall(["library:read"], async (p) => ({
        file: await readMcpLibraryItem(p, sessionId, fileId),
      })),
  );
  server.registerTool(
    "drivebeats_read_folder",
    {
      title: "Read imported folder page",
      description:
        "Read one page of Playable Tracks and descendant folders from an Imported Folder. Drive is read-only.",
      inputSchema: z.strictObject({ sessionId, folderId: fileId, pageToken }),
      annotations: { ...readOnly, openWorldHint: true },
      _meta: meta(["library:read"], true),
    },
    ({ sessionId, folderId, pageToken }) =>
      protectedCall(["library:read"], (p) =>
        readMcpLibraryFolder(p, sessionId, folderId, pageToken),
      ),
  );

  const target = { sessionId, operationId };
  server.registerTool(
    "drivebeats_list_sessions",
    {
      title: "Find active DriveBeats player",
      description:
        "Read the account's active player session ID and availability before explicitly targeting Library search or playback. Open the player if no session is active.",
      inputSchema: z.strictObject({}),
      annotations: readOnly,
      _meta: meta(["library:read"]),
    },
    () => protectedCall(["library:read"], (p) => listMcpMusicSessions(p)),
  );
  const boundedPage = {
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  };
  server.registerTool(
    "drivebeats_search_library",
    {
      title: "Search imported Library",
      description:
        "Search filenames across every Playable Track in the active player's full imported Library, including tracks absent from saved collections. Requires one explicitly selected session. Returns queued until the player acknowledges; retry the same operation ID to receive its result.",
      inputSchema: z.strictObject({
        ...target,
        query: z.string().trim().min(1).max(200),
        ...boundedPage,
      }),
      annotations: readOnly,
      _meta: meta(["library:read"]),
    },
    ({ sessionId, operationId, ...payload }) =>
      protectedCall(["library:read"], (p) =>
        dispatchMcpMusicCommand(p, {
          sessionId,
          operationId,
          type: "search_library",
          payload,
        }),
      ),
  );
  server.registerTool(
    "drivebeats_browse_folder",
    {
      title: "Browse Library folder",
      description:
        "Browse a folder within the selected player's imported Library. Use folderId root to list imported Library roots. Uses the complete local catalog; results are bounded and paginated.",
      inputSchema: z.strictObject({
        ...target,
        folderId: fileId,
        ...boundedPage,
      }),
      annotations: readOnly,
      _meta: meta(["library:read"]),
    },
    ({ sessionId, operationId, ...payload }) =>
      protectedCall(["library:read"], async (p) => {
        if (payload.folderId !== "root") {
          const folder = await readMcpLibraryItem(
            p,
            sessionId,
            payload.folderId,
          );
          if (folder.mimeType !== "application/vnd.google-apps.folder")
            throw new McpLibraryError("Choose an Imported Folder.");
        }
        return dispatchMcpMusicCommand(p, {
          sessionId,
          operationId,
          type: "browse_folder",
          payload,
        });
      }),
  );
  server.registerTool(
    "drivebeats_get_playback_state",
    {
      title: "Read active player state",
      description:
        "Ask the explicitly targeted player for its current track, Playback Queue and actual audio state. A disconnected or closed player is unavailable.",
      inputSchema: z.strictObject(target),
      annotations: readOnly,
      _meta: meta(["media:read"]),
    },
    (input) =>
      protectedCall(["media:read"], (p) =>
        dispatchMcpMusicCommand(p, {
          ...input,
          type: "get_playback_state",
          payload: {},
        }),
      ),
  );
  server.registerTool(
    "drivebeats_play_track",
    {
      title: "Play imported track",
      description:
        "Request playback of a verified Playable Track in the selected player's imported Library. The player acknowledges applied, failed or unavailable; browser gesture requirements still apply.",
      inputSchema: z.strictObject({ ...target, fileId }),
      annotations: action,
      _meta: meta(["media:read"]),
    },
    ({ sessionId, operationId, fileId }) =>
      protectedCall(["media:read"], async (p) => {
        await validateImportedTrack(p, sessionId, fileId);
        return dispatchMcpMusicCommand(p, {
          sessionId,
          operationId,
          type: "play_track",
          payload: { fileId },
        });
      }),
  );
  server.registerTool(
    "drivebeats_pause_playback",
    {
      title: "Pause active player",
      description:
        "Pause the selected player and receive its actual execution acknowledgement.",
      inputSchema: z.strictObject(target),
      annotations: action,
      _meta: meta(["media:read"]),
    },
    (input) =>
      protectedCall(["media:read"], (p) =>
        dispatchMcpMusicCommand(p, {
          ...input,
          type: "pause_playback",
          payload: {},
        }),
      ),
  );
  server.registerTool(
    "drivebeats_skip_track",
    {
      title: "Skip in Playback Queue",
      description:
        "Move once to the next or previous Playable Track. Reuse the operation ID on retries so this action cannot skip twice.",
      inputSchema: z.strictObject({
        ...target,
        direction: z.enum(["next", "previous"]).default("next"),
      }),
      annotations: action,
      _meta: meta(["media:read"]),
    },
    ({ sessionId, operationId, direction }) =>
      protectedCall(["media:read"], (p) =>
        dispatchMcpMusicCommand(p, {
          sessionId,
          operationId,
          type: "skip_track",
          payload: { direction },
        }),
      ),
  );
  server.registerTool(
    "drivebeats_queue_tracks",
    {
      title: "Update temporary Playback Queue",
      description:
        "Append to or replace the device-local Playback Queue with verified imported tracks. This does not create a saved Playlist. Reuse the same operation ID when retrying.",
      inputSchema: z.strictObject({
        ...target,
        fileIds: z.array(fileId).min(1).max(100),
        mode: z.enum(["append", "replace"]).default("append"),
      }),
      annotations: action,
      _meta: meta(["media:read"]),
    },
    ({ sessionId, operationId, fileIds, mode }) =>
      protectedCall(["media:read"], async (p) => {
        await validateImportedTracks(p, sessionId, fileIds);
        return dispatchMcpMusicCommand(p, {
          sessionId,
          operationId,
          type: "queue_tracks",
          payload: { fileIds, mode },
        });
      }),
  );

  server.registerTool(
    "drivebeats_create_playlist",
    {
      title: "Save a synced Playlist",
      description:
        "Save a named Playlist of verified imported Playable Tracks in the requested order. Visible on the website after refresh. This is separate from the temporary Playback Queue. Reuse the operation ID with identical arguments on retry.",
      inputSchema: z.strictObject({
        ...target,
        name: z.string().trim().min(1).max(500),
        fileIds: z.array(fileId).min(1).max(MAX_TRACKS_PER_PLAYLIST),
      }),
      annotations: action,
      _meta: meta(["library:write"]),
    },
    ({ sessionId, operationId, name, fileIds }) =>
      protectedCall(["library:write"], (p) =>
        runMcpMusicOperation(
          p,
          {
            sessionId,
            operationId,
            type: "create_playlist",
            payload: { name, fileIds },
          },
          async () => {
            const tracks = await validateImportedTracks(p, sessionId, fileIds);
            const id = `mcp-${createHash("sha256").update(`${p.googleUserId}:${sessionId}:${operationId}`).digest("hex")}`;
            const saved = await createPlaylistWithTracksRecord(
              p.profile,
              { id, name },
              tracks,
            );
            return { playlistId: id, name, trackCount: saved.trackCount };
          },
        ),
      ),
  );
  server.registerTool(
    "drivebeats_set_favorite",
    {
      title: "Update synced favorite",
      description:
        "Add a verified imported Playable Track to synced favorites or remove an existing favorite owned by your account. Removal does not require reimporting a saved track. Does not change Google Drive.",
      inputSchema: z.strictObject({
        sessionId,
        fileId,
        isFavorite: z.boolean(),
      }),
      annotations: action,
      _meta: meta(["library:write"]),
    },
    ({ sessionId, fileId, isFavorite }) =>
      protectedCall(["library:write"], async (p) => {
        await getMcpMusicSession(p, sessionId);
        const track = isFavorite
          ? await validateImportedTrack(p, sessionId, fileId)
          : (await getCloudLibrarySyncPayload(p.profile)).favorites.find(
              (track) => track.fileId === fileId,
            );
        if (!track) return { status: "applied", fileId, isFavorite: false };
        await setFavoriteTrackRecord(p.profile, track, isFavorite);
        return { status: "applied", fileId, isFavorite };
      }),
  );
}
