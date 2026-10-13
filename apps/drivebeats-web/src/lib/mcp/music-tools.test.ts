// @vitest-environment node
import type { McpServer } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import { McpAuthError, type McpPrincipal } from "./auth";
import { McpLibraryError } from "./music-library-service";
import { registerMusicTools } from "./music-tools";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  validate: vi.fn(),
  dispatch: vi.fn(),
  run: vi.fn(),
  create: vi.fn(),
  add: vi.fn(),
  favorite: vi.fn(),
  cloud: vi.fn(),
  session: vi.fn(),
}));
vi.mock("./auth", async (load) => ({
  ...(await load<object>()),
  authenticateMcpRequest: mocks.auth,
}));
vi.mock("./music-library-service", async (load) => ({
  ...(await load<object>()),
  validateImportedTrack: mocks.validate,
  validateImportedTracks: async (
    principal: McpPrincipal,
    sessionId: string,
    fileIds: string[],
  ) =>
    Promise.all(
      [...new Set(fileIds)].map((id) =>
        mocks.validate(principal, sessionId, id),
      ),
    ),
}));
vi.mock("./music-session-service", async (load) => ({
  ...(await load<object>()),
  openMcpMusicSession: vi.fn(),
  getMcpMusicSession: mocks.session,
  heartbeatMcpMusicSession: vi.fn(),
  pollMcpMusicSession: vi.fn(),
  acknowledgeMcpMusicCommand: vi.fn(),
  closeMcpMusicSession: vi.fn(),
  dispatchMcpMusicCommand: mocks.dispatch,
  runMcpMusicOperation: mocks.run,
}));
vi.mock("@/lib/cloud-library-service", () => ({
  createPlaylistWithTracksRecord: mocks.create,
  setFavoriteTrackRecord: mocks.favorite,
  getCloudLibrarySyncPayload: mocks.cloud,
}));

type Registration = {
  inputSchema: ZodType;
  _meta: Record<string, unknown>;
  annotations: Record<string, unknown>;
};
type ToolCallback = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}>;
const principal = {
  googleUserId: "verified",
  grantId: "grant",
  profile: { id: "verified", email: "verified@example.com" },
  scopes: ["library:read", "library:write", "media:read"],
} as McpPrincipal;
const sessionId = "f2413200-7533-4007-8abf-c0186bba0e19";
const operationId = "a596fceb-9c87-42df-bbc6-2e2e52e08302";
let registry: Map<string, { config: Registration; callback: ToolCallback }>;

beforeEach(() => {
  vi.resetAllMocks();
  registry = new Map();
  const server = {
    registerTool: (
      name: string,
      config: Registration,
      callback: ToolCallback,
    ) => registry.set(name, { config, callback }),
  } as unknown as McpServer;
  registerMusicTools(server, new Request("https://drivebeats.example/mcp"));
  mocks.auth.mockResolvedValue(principal);
  mocks.session.mockResolvedValue({ sessionId });
  mocks.cloud.mockResolvedValue({ playlists: [], favorites: [] });
  mocks.validate.mockImplementation(async (_principal, _sessionId, fileId) => ({
    fileId,
    fileName: `${fileId}.mp3`,
    mimeType: "audio/mpeg",
  }));
  mocks.dispatch.mockResolvedValue({ status: "queued", operationId });
  mocks.run.mockImplementation(async (_principal, _input, execute) => ({
    status: "applied",
    operationId,
    result: await execute("claim"),
  }));
  mocks.create.mockResolvedValue({ trackCount: 2 });
});
async function call(name: string, input: Record<string, unknown>) {
  const tool = registry.get(name);
  if (!tool) throw new Error("Missing tool");
  const parsed = tool.config.inputSchema.parse(input) as Record<
    string,
    unknown
  >;
  return tool.callback(parsed);
}

describe("production music tools", () => {
  it("requires explicit session, stable operation IDs and rejects model identity or fabricated metadata", async () => {
    await expect(
      call("drivebeats_play_track", {
        sessionId,
        operationId,
        fileId: "track",
        userId: "other",
      }),
    ).rejects.toThrow();
    await expect(
      call("drivebeats_play_track", { fileId: "track" }),
    ).rejects.toThrow();
    await expect(
      call("drivebeats_create_playlist", {
        sessionId,
        operationId,
        name: "Playlist",
        fileIds: ["track"],
        tracks: [{ fileId: "track", fileName: "invented" }],
      }),
    ).rejects.toThrow();
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("enforces read, media and independent cloud write scopes", async () => {
    await call("drivebeats_search_library", {
      sessionId,
      operationId,
      query: "file",
    });
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.any(Request), [
      "library:read",
    ]);
    await call("drivebeats_play_track", {
      sessionId,
      operationId,
      fileId: "track",
    });
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.any(Request), [
      "media:read",
    ]);
    mocks.auth.mockRejectedValueOnce(
      new McpAuthError("insufficient_scope", 403),
    );
    const denied = await call("drivebeats_create_playlist", {
      sessionId,
      operationId,
      name: "Playlist",
      fileIds: ["track"],
    });
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.any(Request), [
      "library:write",
    ]);
    expect(denied.isError).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not dispatch playback or queue changes containing an unrelated track", async () => {
    mocks.validate.mockRejectedValueOnce(
      new McpLibraryError(
        "This item is outside the session's imported Library.",
      ),
    );
    const failed = await call("drivebeats_queue_tracks", {
      sessionId,
      operationId,
      fileIds: ["unrelated"],
      mode: "replace",
    });
    expect(failed.structuredContent).toMatchObject({ status: "failed" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("creates ordered unique synced tracks from verified provider metadata with durable operation identity", async () => {
    const saved = await call("drivebeats_create_playlist", {
      sessionId,
      operationId,
      name: " Saved ",
      fileIds: ["second", "first", "second"],
    });
    expect(mocks.run).toHaveBeenCalledWith(
      principal,
      {
        sessionId,
        operationId,
        type: "create_playlist",
        payload: { name: "Saved", fileIds: ["second", "first", "second"] },
      },
      expect.any(Function),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      principal.profile,
      { id: expect.stringMatching(/^mcp-[a-f0-9]{64}$/), name: "Saved" },
      [
        { fileId: "second", fileName: "second.mp3", mimeType: "audio/mpeg" },
        { fileId: "first", fileName: "first.mp3", mimeType: "audio/mpeg" },
      ],
    );
    expect(saved.structuredContent).toMatchObject({
      status: "applied",
      operationId,
      result: { name: "Saved", trackCount: 2 },
    });
  });
  it("removes an owned synced favorite without requiring new import or Google access", async () => {
    const savedTrack = {
      fileId: "saved",
      fileName: "Saved metadata.mp3",
      mimeType: "audio/mpeg",
    };
    mocks.cloud.mockResolvedValueOnce({
      playlists: [],
      favorites: [savedTrack],
    });
    await expect(
      call("drivebeats_set_favorite", {
        sessionId,
        fileId: "saved",
        isFavorite: false,
      }),
    ).resolves.toMatchObject({
      structuredContent: { status: "applied", isFavorite: false },
    });
    expect(mocks.favorite).toHaveBeenCalledWith(
      principal.profile,
      savedTrack,
      false,
    );
    expect(mocks.validate).not.toHaveBeenCalled();
    mocks.favorite.mockClear();
    await call("drivebeats_set_favorite", {
      sessionId,
      fileId: "not-owned",
      isFavorite: false,
    });
    expect(mocks.favorite).not.toHaveBeenCalled();
    mocks.validate.mockRejectedValueOnce(
      new McpLibraryError("outside imported Library"),
    );
    await expect(
      call("drivebeats_set_favorite", {
        sessionId,
        fileId: "not-imported",
        isFavorite: true,
      }),
    ).resolves.toMatchObject({ isError: true });
    expect(mocks.favorite).not.toHaveBeenCalled();
  });
  it("publishes app-only bookkeeping separately from requested model actions", () => {
    expect(registry.get("drivebeats_poll_session")?.config._meta).toMatchObject(
      { ui: { visibility: ["app"] } },
    );
    expect(
      registry.get("drivebeats_search_library")?.config._meta.ui,
    ).toBeUndefined();
    expect(
      registry.get("drivebeats_create_playlist")?.config.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(
      registry.get("drivebeats_queue_tracks")?.config.annotations.readOnlyHint,
    ).toBe(false);
  });
});
