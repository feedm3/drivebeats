// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeMcpMusicCommandRow,
  claimMcpMusicCommand,
  findMcpMusicCommand,
  insertMcpMusicCommand,
  type McpMusicCommandRow,
} from "@/db/mcp-music-commands";
import {
  consumeMcpMusicImportRow,
  findMcpMusicImport,
  insertMcpMusicImport,
} from "@/db/mcp-music-imports";
import {
  findMcpMusicSession,
  heartbeatMcpMusicSessionRow,
  insertMcpMusicSession,
  listMcpMusicSessionRows,
  setMcpMusicSessionImportsRow,
} from "@/db/mcp-music-sessions";
import { decryptMcpSecret, encryptMcpSecret, type McpPrincipal } from "./auth";
import {
  acknowledgeMcpMusicCommand,
  consumeMcpMusicImport,
  createMcpMusicImport,
  getMcpMusicSession,
  heartbeatMcpMusicSession,
  listMcpMusicSessions,
  openMcpMusicSession,
  pollMcpMusicSession,
  runMcpMusicOperation,
} from "./music-session-service";

vi.mock("@/db/mcp-music-sessions", () => ({
  findMcpMusicSession: vi.fn(),
  listMcpMusicSessionRows: vi.fn(),
  heartbeatMcpMusicSessionRow: vi.fn(),
  insertMcpMusicSession: vi.fn(),
  setMcpMusicSessionImportsRow: vi.fn(),
  closeMcpMusicSessionRow: vi.fn(),
}));
vi.mock("@/db/mcp-music-commands", () => ({
  acknowledgeMcpMusicCommandRow: vi.fn(),
  claimMcpMusicCommand: vi.fn(),
  findMcpMusicCommand: vi.fn(),
  insertMcpMusicCommand: vi.fn(),
}));
vi.mock("@/db/mcp-music-imports", () => ({
  consumeMcpMusicImportRow: vi.fn(),
  findMcpMusicImport: vi.fn(),
  insertMcpMusicImport: vi.fn(),
}));
vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  decryptMcpSecret: vi.fn(),
  encryptMcpSecret: vi.fn(),
}));

const id = "9b62121e-d0d0-4c0e-96de-e80b1a547a9c";
const claimToken = "8973221e-d0d0-4c0e-96de-e80b1a547a9c";
const principal: McpPrincipal = {
  grantId: "grant-a",
  googleUserId: "account-a",
  profile: {
    id: "account-a",
    email: "a@example.com",
    name: "A",
    picture: null,
  },
  scopes: ["library:read", "media:read"],
};
const operation = {
  sessionId: id,
  operationId: "save-a",
  type: "create_playlist" as const,
  payload: { name: "Morning", fileIds: ["track-a"] },
};
const session = () => ({
  id,
  grant_id: principal.grantId,
  google_user_id: principal.googleUserId,
  imported_folder_ids: ["folder-a"],
  standalone_track_ids: [],
  catalog_ready: true,
  imports_revision: 0,
  import_receipt: null,
  expires_at: new Date(Date.now() + 60000).toISOString(),
});
let commands: Map<string, McpMusicCommandRow>;

beforeEach(() => {
  vi.resetAllMocks();
  commands = new Map();
  vi.mocked(findMcpMusicSession).mockResolvedValue(session());
  vi.mocked(heartbeatMcpMusicSessionRow).mockResolvedValue(session());
  vi.mocked(insertMcpMusicSession).mockResolvedValue(session());
  vi.mocked(insertMcpMusicCommand).mockImplementation(async (input) => {
    const existing = commands.get(input.operationId);
    if (existing) return existing;
    const row: McpMusicCommandRow = {
      session_id: id,
      operation_id: input.operationId,
      command_type: input.type,
      executor: input.executor,
      payload: input.payload,
      payload_hash: input.payloadHash,
      status: "queued",
      claim_token: null,
      result: null,
      expires_at: new Date(Date.now() + 30000).toISOString(),
      imports_revision: input.importsRevision,
    };
    commands.set(input.operationId, row);
    return row;
  });
  vi.mocked(findMcpMusicCommand).mockImplementation(
    async (_, operationId) => commands.get(operationId) ?? null,
  );
  vi.mocked(claimMcpMusicCommand).mockImplementation(
    async (_, token, operationId) => {
      if ([...commands.values()].some((row) => row.status === "claimed"))
        return null;
      const row = operationId
        ? commands.get(operationId)
        : [...commands.values()].find(
            (row) => row.executor === "browser" && row.status === "queued",
          );
      if (
        row?.status !== "queued" ||
        new Date(row.expires_at).getTime() <= Date.now()
      )
        return null;
      row.status = "claimed";
      row.claim_token = token;
      return row;
    },
  );
  vi.mocked(acknowledgeMcpMusicCommandRow).mockImplementation(
    async (_, operationId, token, status, result) => {
      const row = commands.get(operationId);
      if (
        row?.status !== "claimed" ||
        row.claim_token !== token ||
        new Date(row.expires_at).getTime() <= Date.now()
      )
        return false;
      row.status = status;
      row.result = result;
      return true;
    },
  );
});

describe("account-scoped player mailbox", () => {
  it("denies missing/foreign sessions before claiming commands", async () => {
    vi.mocked(findMcpMusicSession).mockResolvedValue(null);
    await expect(pollMcpMusicSession(principal, id)).rejects.toMatchObject({
      status: 404,
    });
    expect(findMcpMusicSession).toHaveBeenCalledWith(
      id,
      "grant-a",
      "account-a",
    );
    expect(claimMcpMusicCommand).not.toHaveBeenCalled();
    await expect(
      getMcpMusicSession({ ...principal, googleUserId: "account-b" }, id),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("heartbeat cannot replace server-approved imports", async () => {
    await heartbeatMcpMusicSession(principal, {
      sessionId: id,
      catalogReady: true,
      catalogRevision: 0,
      importedFolderIds: ["invented"],
    } as Parameters<typeof heartbeatMcpMusicSession>[1]);
    expect(heartbeatMcpMusicSessionRow).toHaveBeenCalledWith(
      id,
      "grant-a",
      "account-a",
      true,
      0,
    );
    expect(setMcpMusicSessionImportsRow).not.toHaveBeenCalled();
  });
  it("serializes concurrent server actions and returns the same saved result on retries", async () => {
    let finish: (value: Record<string, unknown>) => void = () => {};
    const execute = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finish = resolve;
        }),
    );
    const first = runMcpMusicOperation(principal, operation, execute);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const retry = await runMcpMusicOperation(principal, operation, execute);
    expect(retry.status).toBe("queued");
    finish({ playlistId: "playlist-a" });
    const result = await first;
    expect(result).toMatchObject({
      status: "applied",
      result: { playlistId: "playlist-a" },
    });
    expect(await runMcpMusicOperation(principal, operation, execute)).toEqual(
      result,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("rejects reused IDs with different actions, while equivalent object key order deduplicates", async () => {
    const execute = vi.fn(async () => ({ playlistId: "playlist-a" }));
    await runMcpMusicOperation(principal, operation, execute);
    await expect(
      runMcpMusicOperation(
        principal,
        { ...operation, payload: { name: "Different" } },
        execute,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await runMcpMusicOperation(
      principal,
      { ...operation, payload: { fileIds: ["track-a"], name: "Morning" } },
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not replay an ambiguous failed server write", async () => {
    const execute = vi.fn(async () => {
      throw new Error("provider-secret");
    });
    const result = await runMcpMusicOperation(principal, operation, execute);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("provider-secret");
    expect(await runMcpMusicOperation(principal, operation, execute)).toEqual(
      result,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("rejects stale claims, duplicate acknowledgements and late command results", async () => {
    await insertMcpMusicCommand({
      ...operation,
      payloadHash: "hash",
      executor: "browser",
      importsRevision: 0,
    });
    const polled = await pollMcpMusicSession(principal, id);
    expect(polled.command).not.toBeNull();
    expect(
      (
        await acknowledgeMcpMusicCommand(principal, {
          sessionId: id,
          operationId: operation.operationId,
          claimToken,
          status: "applied",
          result: {},
        })
      ).acknowledged,
    ).toBe(false);
    const valid = {
      sessionId: id,
      operationId: operation.operationId,
      claimToken: polled.command?.claimToken ?? claimToken,
      status: "applied" as const,
      result: {},
    };
    expect(
      (await acknowledgeMcpMusicCommand(principal, valid)).acknowledged,
    ).toBe(true);
    expect(
      (await acknowledgeMcpMusicCommand(principal, valid)).acknowledged,
    ).toBe(false);
    const row = commands.get(operation.operationId);
    if (!row) throw new Error("Missing command");
    row.status = "claimed";
    row.expires_at = new Date(0).toISOString();
    expect(
      (await acknowledgeMcpMusicCommand(principal, valid)).acknowledged,
    ).toBe(false);
    vi.mocked(findMcpMusicSession).mockResolvedValue(null);
    await expect(
      acknowledgeMcpMusicCommand(principal, valid),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects oversized payloads and results before storage", async () => {
    await expect(
      runMcpMusicOperation(
        principal,
        {
          ...operation,
          type: "queue_tracks",
          payload: { catalog: "a".repeat(8200) },
        },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(insertMcpMusicCommand).not.toHaveBeenCalled();
    await expect(
      acknowledgeMcpMusicCommand(principal, {
        sessionId: id,
        operationId: "a",
        claimToken,
        status: "applied",
        result: { catalog: "a".repeat(25000) },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(acknowledgeMcpMusicCommandRow).not.toHaveBeenCalled();
  });
  it("lists only owned active session metadata without publishing imported roots", async () => {
    vi.mocked(listMcpMusicSessionRows).mockResolvedValue([session()]);
    const result = await listMcpMusicSessions(principal);
    expect(listMcpMusicSessionRows).toHaveBeenCalledWith(
      "grant-a",
      "account-a",
    );
    expect(result.sessions).toEqual([
      { sessionId: id, expiresAt: expect.any(String), catalogReady: true },
    ]);
    expect(JSON.stringify(result)).not.toContain("folder-a");
  });
  it.each(["account", "grant", "expires"])(
    "cannot restore another or expired %s receipt",
    async (kind) => {
      const receipt = {
        account: "account-a",
        grant: "grant-a",
        expires: Date.now() + 60000,
        folders: ["folder-a"],
        tracks: [],
      };
      if (kind === "account") receipt.account = "account-b";
      if (kind === "grant") receipt.grant = "grant-b";
      if (kind === "expires") receipt.expires = 0;
      vi.mocked(decryptMcpSecret).mockResolvedValue(receipt);
      await expect(
        openMcpMusicSession(principal, { importReceipt: "encrypted" }),
      ).rejects.toMatchObject({ status: 400 });
      expect(insertMcpMusicSession).not.toHaveBeenCalled();
    },
  );
  it("restores only the verified receipt roots into a fresh session", async () => {
    vi.mocked(decryptMcpSecret).mockResolvedValue({
      account: "account-a",
      grant: "grant-a",
      expires: Date.now() + 60000,
      folders: ["folder-a"],
      tracks: ["track-a"],
    });
    vi.mocked(setMcpMusicSessionImportsRow).mockResolvedValue({
      ...session(),
      import_receipt: "encrypted",
      standalone_track_ids: ["track-a"],
    });
    const result = await openMcpMusicSession(principal, {
      importReceipt: "encrypted",
    });
    expect(result.standaloneTrackIds).toEqual(["track-a"]);
    expect(setMcpMusicSessionImportsRow).toHaveBeenCalledWith(
      id,
      "grant-a",
      "account-a",
      ["folder-a"],
      ["track-a"],
      "encrypted",
    );
  });
});

describe("trusted external selection capability", () => {
  it("stores only a capability hash and uses the website login origin", async () => {
    vi.mocked(insertMcpMusicImport).mockResolvedValue({
      expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    const result = await createMcpMusicImport(principal, id);
    const capability = result.url.split("/").at(-1);
    expect(result.url).toMatch(
      /^https:\/\/www.drivebeats.app\/mcp\/import\/[A-Za-z0-9_-]{43}$/,
    );
    const saved = vi.mocked(insertMcpMusicImport).mock.calls[0][0];
    expect(saved).toMatch(/^[0-9a-f]{64}$/);
    expect(saved).not.toBe(capability);
  });
  it("rejects foreign-account and previously consumed links before approval", async () => {
    vi.mocked(findMcpMusicImport).mockResolvedValue(null);
    await expect(
      consumeMcpMusicImport("a".repeat(43), "account-b", {
        importedFolderIds: ["folder-b"],
        standaloneTrackIds: [],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(consumeMcpMusicImportRow).not.toHaveBeenCalled();
    expect(encryptMcpSecret).not.toHaveBeenCalled();
  });
  it("consumes once with account/grant-bound receipt and rejects duplicate completion", async () => {
    vi.mocked(findMcpMusicImport).mockResolvedValue({
      id,
      grant_id: "grant-a",
      google_user_id: "account-a",
      import_expires_at: new Date(Date.now() + 600000).toISOString(),
    });
    vi.mocked(encryptMcpSecret).mockResolvedValue("encrypted");
    vi.mocked(consumeMcpMusicImportRow)
      .mockResolvedValueOnce({ id })
      .mockResolvedValueOnce(null);
    const selection = {
      importedFolderIds: ["folder-a"],
      standaloneTrackIds: ["track-a"],
    };
    expect(
      await consumeMcpMusicImport("a".repeat(43), "account-a", selection),
    ).toEqual({ sessionId: id });
    expect(encryptMcpSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "account-a",
        grant: "grant-a",
        folders: ["folder-a"],
        tracks: ["track-a"],
      }),
      "music-import",
    );
    await expect(
      consumeMcpMusicImport("a".repeat(43), "account-a", selection),
    ).rejects.toMatchObject({ status: 409 });
  });
});
