import { getSql } from "@/db/client";

export interface McpMusicCommandRow {
  session_id: string;
  operation_id: string;
  command_type: string;
  executor: "browser" | "server";
  payload: Record<string, unknown>;
  payload_hash: string;
  status: "queued" | "claimed" | "applied" | "failed";
  claim_token: string | null;
  result: Record<string, unknown> | null;
  expires_at: string;
  imports_revision: number;
}

export async function insertMcpMusicCommand(input: {
  sessionId: string;
  operationId: string;
  type: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  executor: "browser" | "server";
  importsRevision: number;
}): Promise<McpMusicCommandRow | null> {
  const sql = getSql();
  const results = await sql.transaction([
    sql.query("SELECT id FROM mcp_music_sessions WHERE id = $1 FOR UPDATE", [
      input.sessionId,
    ]),
    sql.query(
      `INSERT INTO mcp_music_commands (session_id,operation_id,command_type,executor,payload,payload_hash,expires_at,imports_revision)
      SELECT $1,$2,$3,$4,$5::jsonb,$6,NOW() + INTERVAL '30 seconds',$7
      WHERE EXISTS (SELECT 1 FROM mcp_music_sessions WHERE id = $1 AND closed_at IS NULL AND expires_at > NOW() AND imports_revision = $7)
      AND (SELECT COUNT(*) FROM mcp_music_commands WHERE session_id = $1) < 500
      ON CONFLICT (session_id,operation_id) DO NOTHING`,
      [
        input.sessionId,
        input.operationId,
        input.type,
        input.executor,
        JSON.stringify(input.payload),
        input.payloadHash,
        input.importsRevision,
      ],
    ),
    sql.query(
      "SELECT * FROM mcp_music_commands WHERE session_id = $1 AND operation_id = $2",
      [input.sessionId, input.operationId],
    ),
  ]);
  return (results[2] as McpMusicCommandRow[])[0] ?? null;
}

export async function findMcpMusicCommand(
  sessionId: string,
  operationId: string,
): Promise<McpMusicCommandRow | null> {
  const rows = (await getSql().query(
    "SELECT * FROM mcp_music_commands WHERE session_id = $1 AND operation_id = $2",
    [sessionId, operationId],
  )) as McpMusicCommandRow[];
  return rows[0] ?? null;
}

export async function claimMcpMusicCommand(
  sessionId: string,
  claimToken: string,
  operationId?: string,
): Promise<McpMusicCommandRow | null> {
  const sql = getSql();
  const results = await sql.transaction([
    sql.query("SELECT id FROM mcp_music_sessions WHERE id = $1 FOR UPDATE", [
      sessionId,
    ]),
    sql.query(
      `UPDATE mcp_music_commands SET status = 'claimed', claim_token = $2 WHERE (session_id,operation_id) = (
      SELECT session_id,operation_id FROM mcp_music_commands WHERE session_id = $1 AND status = 'queued' AND expires_at > NOW()
      AND (($3::text IS NULL AND executor = 'browser') OR (operation_id = $3 AND executor = 'server'))
      AND EXISTS (SELECT 1 FROM mcp_music_sessions s WHERE s.id = $1 AND s.closed_at IS NULL AND s.expires_at > NOW() AND s.imports_revision = mcp_music_commands.imports_revision)
      AND NOT EXISTS (SELECT 1 FROM mcp_music_commands WHERE session_id = $1 AND status = 'claimed' AND expires_at > NOW())
      ORDER BY created_at,operation_id LIMIT 1) RETURNING *`,
      [sessionId, claimToken, operationId ?? null],
    ),
  ]);
  return (results[1] as McpMusicCommandRow[])[0] ?? null;
}

export async function acknowledgeMcpMusicCommandRow(
  sessionId: string,
  operationId: string,
  claimToken: string,
  status: "applied" | "failed",
  result: Record<string, unknown>,
) {
  const sql = getSql();
  const results = await sql.transaction([
    sql.query("SELECT id FROM mcp_music_sessions WHERE id = $1 FOR UPDATE", [
      sessionId,
    ]),
    sql.query(
      `UPDATE mcp_music_commands SET status = $4, result = $5::jsonb WHERE session_id = $1 AND operation_id = $2 AND claim_token = $3 AND status = 'claimed' AND expires_at > NOW() AND EXISTS (SELECT 1 FROM mcp_music_sessions s WHERE s.id = $1 AND s.closed_at IS NULL AND s.expires_at > NOW() AND s.imports_revision = mcp_music_commands.imports_revision) RETURNING operation_id`,
      [sessionId, operationId, claimToken, status, JSON.stringify(result)],
    ),
  ]);
  const rows = results[1] as { operation_id: string }[];
  return rows.length === 1;
}
