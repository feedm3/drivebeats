import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  closeMcpMusicSessionRow,
  findMcpMusicSession,
  heartbeatMcpMusicSessionRow,
  insertMcpMusicSession,
  listMcpMusicSessionRows,
  type McpMusicSessionRow,
  setMcpMusicSessionImportsRow,
} from "@/db/mcp-music-sessions";
import { SITE_URL } from "@/lib/site";
import {
  decryptMcpSecret,
  encryptMcpSecret,
  McpAuthError,
  type McpPrincipal,
} from "./auth";

export class McpMusicSessionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const MCP_MUSIC_COMMAND_TYPES = [
  "search_library",
  "browse_folder",
  "get_playback_state",
  "play_track",
  "pause_playback",
  "skip_track",
  "queue_tracks",
  "create_playlist",
] as const;
export interface McpMusicOperation {
  sessionId: string;
  operationId: string;
  type: (typeof MCP_MUSIC_COMMAND_TYPES)[number];
  payload: Record<string, unknown>;
}

function requirePrincipal(principal: McpPrincipal) {
  if (principal.profile.id !== principal.googleUserId) throw new McpAuthError();
}
function sessionId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new McpMusicSessionError(400, "Invalid player session.");
}
function boundedObject(value: Record<string, unknown>, maximum: number) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Buffer.byteLength(JSON.stringify(value)) > maximum
  )
    throw new McpMusicSessionError(
      400,
      "Music command payload exceeds its limit.",
    );
}
function ids(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (item) =>
        typeof item !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(item),
    )
  )
    throw new McpMusicSessionError(400, "Invalid imported music selection.");
  return [...new Set(value as string[])];
}
function snapshot(row: McpMusicSessionRow) {
  return {
    sessionId: row.id,
    importedFolderIds: row.imported_folder_ids,
    standaloneTrackIds: row.standalone_track_ids,
    catalogReady: row.catalog_ready,
    importsRevision: row.imports_revision,
    importReceipt: row.import_receipt,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonical(value)]),
    );
  return value;
}
function commandDigest(input: McpMusicOperation) {
  return hash(
    JSON.stringify(canonical({ type: input.type, payload: input.payload })),
  );
}
function validateOperation(input: McpMusicOperation) {
  sessionId(input.sessionId);
  if (
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.operationId) ||
    !MCP_MUSIC_COMMAND_TYPES.includes(input.type)
  )
    throw new McpMusicSessionError(400, "Invalid music operation.");
  boundedObject(input.payload, input.type === "create_playlist" ? 65536 : 8192);
}
function operationResult(row: McpMusicCommandRow | null, operationId: string) {
  if (!row) return { status: "unavailable" as const, operationId };
  if (row.status === "applied" || row.status === "failed")
    return { status: row.status, operationId, result: row.result ?? {} };
  if (new Date(row.expires_at).getTime() <= Date.now())
    return { status: "unavailable" as const, operationId };
  return { status: "queued" as const, operationId };
}

export async function getMcpMusicSession(principal: McpPrincipal, id: string) {
  requirePrincipal(principal);
  sessionId(id);
  const row = await findMcpMusicSession(
    id,
    principal.grantId,
    principal.googleUserId,
  );
  if (!row)
    throw new McpMusicSessionError(
      404,
      "The player session is unavailable. Open DriveBeats again.",
    );
  return snapshot(row);
}

export async function openMcpMusicSession(
  principal: McpPrincipal,
  input: { importReceipt?: string } = {},
) {
  requirePrincipal(principal);
  let restored: { folders: string[]; tracks: string[] } | null = null;
  if (input.importReceipt) {
    if (input.importReceipt.length > 20_000)
      throw new McpMusicSessionError(400, "Invalid imported music receipt.");
    try {
      const receipt = await decryptMcpSecret(
        input.importReceipt,
        "music-import",
      );
      if (
        receipt.account !== principal.googleUserId ||
        receipt.grant !== principal.grantId ||
        typeof receipt.expires !== "number" ||
        receipt.expires <= Date.now()
      )
        throw new Error("Invalid receipt");
      restored = { folders: ids(receipt.folders), tracks: ids(receipt.tracks) };
    } catch {
      throw new McpMusicSessionError(
        400,
        "Imported music authorization expired. Select your music again.",
      );
    }
  }
  const row = await insertMcpMusicSession(
    randomUUID(),
    principal.grantId,
    principal.googleUserId,
  );
  if (restored && input.importReceipt) {
    const updated = await setMcpMusicSessionImportsRow(
      row.id,
      principal.grantId,
      principal.googleUserId,
      restored.folders,
      restored.tracks,
      input.importReceipt,
    );
    if (updated) return snapshot(updated);
  }
  return snapshot(row);
}

export async function heartbeatMcpMusicSession(
  principal: McpPrincipal,
  input: { sessionId: string; catalogReady: boolean; catalogRevision: number },
) {
  requirePrincipal(principal);
  sessionId(input.sessionId);
  if (
    typeof input.catalogReady !== "boolean" ||
    !Number.isSafeInteger(input.catalogRevision) ||
    input.catalogRevision < 0
  )
    throw new McpMusicSessionError(400, "Invalid Library catalog revision.");
  const row = await heartbeatMcpMusicSessionRow(
    input.sessionId,
    principal.grantId,
    principal.googleUserId,
    input.catalogReady,
    input.catalogRevision,
  );
  if (!row)
    throw new McpMusicSessionError(
      404,
      "The player session expired. Open DriveBeats again.",
    );
  return snapshot(row);
}

export async function closeMcpMusicSession(
  principal: McpPrincipal,
  id: string,
) {
  requirePrincipal(principal);
  sessionId(id);
  await closeMcpMusicSessionRow(id, principal.grantId, principal.googleUserId);
  return { closed: true };
}

export async function pollMcpMusicSession(principal: McpPrincipal, id: string) {
  const session = await getMcpMusicSession(principal, id);
  const row = await claimMcpMusicCommand(id, randomUUID());
  return {
    session,
    command: row
      ? {
          operationId: row.operation_id,
          importsRevision: row.imports_revision,
          type: row.command_type,
          payload: row.payload,
          claimToken: row.claim_token as string,
          expiresAt: new Date(row.expires_at).toISOString(),
        }
      : null,
  };
}

export async function acknowledgeMcpMusicCommand(
  principal: McpPrincipal,
  input: {
    sessionId: string;
    operationId: string;
    claimToken: string;
    status: "applied" | "failed";
    result: Record<string, unknown>;
  },
) {
  await getMcpMusicSession(principal, input.sessionId);
  sessionId(input.claimToken);
  boundedObject(input.result, 24576);
  if (
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.operationId) ||
    !["applied", "failed"].includes(input.status)
  )
    throw new McpMusicSessionError(400, "Invalid music acknowledgement.");
  return {
    acknowledged: await acknowledgeMcpMusicCommandRow(
      input.sessionId,
      input.operationId,
      input.claimToken,
      input.status,
      input.result,
    ),
  };
}

async function enqueue(
  principal: McpPrincipal,
  input: McpMusicOperation,
  executor: "browser" | "server",
) {
  validateOperation(input);
  const session = await getMcpMusicSession(principal, input.sessionId);
  const row = await insertMcpMusicCommand({
    ...input,
    payloadHash: commandDigest(input),
    importsRevision: session.importsRevision,
    executor,
  });
  if (
    row &&
    (row.payload_hash !== commandDigest(input) || row.executor !== executor)
  )
    throw new McpMusicSessionError(
      409,
      "This operation ID already refers to a different action.",
    );
  return row;
}

export async function dispatchMcpMusicCommand(
  principal: McpPrincipal,
  input: McpMusicOperation,
) {
  let row = await enqueue(principal, input, "browser");
  // A bounded wait; subsequent calls with the same operation ID read the same result.
  for (
    let attempt = 0;
    attempt < 8 && operationResult(row, input.operationId).status === "queued";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await getMcpMusicSession(principal, input.sessionId);
    row = await findMcpMusicCommand(input.sessionId, input.operationId);
  }
  return operationResult(row, input.operationId);
}

export async function runMcpMusicOperation(
  principal: McpPrincipal,
  input: McpMusicOperation,
  execute: (claimToken: string) => Promise<Record<string, unknown>>,
) {
  const existing = await enqueue(principal, input, "server");
  if (existing?.status !== "queued")
    return operationResult(existing, input.operationId);
  const claimToken = randomUUID();
  const claimed = await claimMcpMusicCommand(
    input.sessionId,
    claimToken,
    input.operationId,
  );
  if (!claimed)
    return operationResult(
      await findMcpMusicCommand(input.sessionId, input.operationId),
      input.operationId,
    );
  try {
    const result = await execute(claimToken);
    boundedObject(result, 24576);
    const acknowledged = await acknowledgeMcpMusicCommand(principal, {
      ...input,
      claimToken,
      status: "applied",
      result,
    });
    return acknowledged.acknowledged
      ? { status: "applied" as const, operationId: input.operationId, result }
      : { status: "unavailable" as const, operationId: input.operationId };
  } catch {
    const result = {
      message:
        "The action did not complete reliably. Refresh your saved Playlists before retrying with a new operation ID.",
    };
    await acknowledgeMcpMusicCommand(principal, {
      ...input,
      claimToken,
      status: "failed",
      result,
    }).catch(() => undefined);
    return {
      status: "failed" as const,
      operationId: input.operationId,
      result,
    };
  }
}

export async function createMcpMusicImport(
  principal: McpPrincipal,
  id: string,
) {
  await getMcpMusicSession(principal, id);
  const capability = randomBytes(32).toString("base64url");
  const row = await insertMcpMusicImport(hash(capability), id);
  if (!row)
    throw new McpMusicSessionError(
      404,
      "The player session expired. Open DriveBeats again.",
    );
  const origin = SITE_URL;
  return {
    url: `${origin}/mcp/import/${capability}`,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
export async function getMcpMusicImport(
  capability: string,
  googleUserId: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability))
    throw new McpMusicSessionError(
      404,
      "This music selection link is unavailable.",
    );
  const row = await findMcpMusicImport(hash(capability), googleUserId);
  if (!row)
    throw new McpMusicSessionError(
      404,
      "This music selection link expired. Open DriveBeats again.",
    );
  return {
    sessionId: row.id,
    grantId: row.grant_id,
    googleUserId: row.google_user_id,
    expiresAt: new Date(row.import_expires_at).toISOString(),
  };
}
/** Call only after the website verifies every selected ID with its Google Picker account. */
export async function consumeMcpMusicImport(
  capability: string,
  googleUserId: string,
  input: { importedFolderIds: string[]; standaloneTrackIds: string[] },
) {
  const importedFolderIds = ids(input.importedFolderIds),
    standaloneTrackIds = ids(input.standaloneTrackIds);
  const handoff = await getMcpMusicImport(capability, googleUserId);
  boundedObject({ importedFolderIds, standaloneTrackIds }, 12000);
  const receipt = await encryptMcpSecret(
    {
      account: googleUserId,
      grant: handoff.grantId,
      folders: importedFolderIds,
      tracks: standaloneTrackIds,
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
    },
    "music-import",
  );
  if (receipt.length > 20000)
    throw new McpMusicSessionError(400, "Too many imported music selections.");
  const row = await consumeMcpMusicImportRow(
    hash(capability),
    googleUserId,
    importedFolderIds,
    standaloneTrackIds,
    receipt,
  );
  if (!row)
    throw new McpMusicSessionError(
      409,
      "This music selection link was already used or expired.",
    );
  return { sessionId: row.id };
}

export async function listMcpMusicSessions(principal: McpPrincipal) {
  requirePrincipal(principal);
  const rows = await listMcpMusicSessionRows(
    principal.grantId,
    principal.googleUserId,
  );
  return {
    sessions: rows.map((row) => ({
      sessionId: row.id,
      expiresAt: new Date(row.expires_at).toISOString(),
      catalogReady: row.catalog_ready,
    })),
  };
}
