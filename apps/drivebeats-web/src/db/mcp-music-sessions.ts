import { getSql } from "@/db/client";

export interface McpMusicSessionRow {
  id: string;
  grant_id: string;
  google_user_id: string;
  imported_folder_ids: string[];
  standalone_track_ids: string[];
  catalog_ready: boolean;
  imports_revision: number;
  import_receipt: string | null;
  expires_at: string;
}

export async function insertMcpMusicSession(
  id: string,
  grantId: string,
  userId: string,
) {
  const sql = getSql();
  const results = await sql.transaction([
    sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [grantId]),
    sql.query(
      "DELETE FROM mcp_music_sessions WHERE id IN (SELECT id FROM mcp_music_sessions WHERE expires_at < NOW() OR closed_at IS NOT NULL LIMIT 500 FOR UPDATE SKIP LOCKED)",
    ),
    sql.query(
      `UPDATE mcp_music_sessions SET closed_at = NOW(), imported_folder_ids = '{}', standalone_track_ids = '{}', import_receipt = NULL, import_pending_until = NULL, catalog_ready = false WHERE grant_id = $1 AND closed_at IS NULL`,
      [grantId],
    ),
    sql.query(
      `INSERT INTO mcp_music_sessions (id, grant_id, google_user_id, expires_at, max_expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '60 seconds',NOW() + INTERVAL '8 hours') RETURNING *`,
      [id, grantId, userId],
    ),
  ]);
  return (results[3] as McpMusicSessionRow[])[0];
}

export async function findMcpMusicSession(
  id: string,
  grantId: string,
  userId: string,
): Promise<McpMusicSessionRow | null> {
  const rows = (await getSql().query(
    `SELECT * FROM mcp_music_sessions WHERE id = $1 AND grant_id = $2 AND google_user_id = $3 AND closed_at IS NULL AND expires_at > NOW() AND max_expires_at > NOW()`,
    [id, grantId, userId],
  )) as McpMusicSessionRow[];
  return rows[0] ?? null;
}

export async function heartbeatMcpMusicSessionRow(
  id: string,
  grantId: string,
  userId: string,
  ready: boolean,
  revision: number,
): Promise<McpMusicSessionRow | null> {
  const rows = (await getSql().query(
    `UPDATE mcp_music_sessions SET expires_at = LEAST(GREATEST(NOW() + INTERVAL '60 seconds', COALESCE(import_pending_until, NOW())), max_expires_at), catalog_ready = ($4 AND imports_revision = $5) WHERE id = $1 AND grant_id = $2 AND google_user_id = $3 AND closed_at IS NULL AND expires_at > NOW() AND max_expires_at > NOW() RETURNING *`,
    [id, grantId, userId, ready, revision],
  )) as McpMusicSessionRow[];
  return rows[0] ?? null;
}

export async function closeMcpMusicSessionRow(
  id: string,
  grantId: string,
  userId: string,
) {
  await getSql().query(
    `UPDATE mcp_music_sessions SET closed_at = NOW(), imported_folder_ids = '{}', standalone_track_ids = '{}', import_receipt = NULL, import_pending_until = NULL, catalog_ready = false WHERE id = $1 AND grant_id = $2 AND google_user_id = $3`,
    [id, grantId, userId],
  );
}

/** Only the authenticated website's verified Picker handoff may call this. */
export async function setMcpMusicSessionImportsRow(
  id: string,
  grantId: string,
  userId: string,
  folders: string[],
  tracks: string[],
  receipt: string,
): Promise<McpMusicSessionRow | null> {
  const rows = (await getSql().query(
    `UPDATE mcp_music_sessions SET imported_folder_ids = $4, standalone_track_ids = $5, import_receipt = $6, imports_revision = imports_revision + 1, catalog_ready = false WHERE id = $1 AND grant_id = $2 AND google_user_id = $3 AND closed_at IS NULL AND expires_at > NOW() RETURNING *`,
    [id, grantId, userId, folders, tracks, receipt],
  )) as McpMusicSessionRow[];
  return rows[0] ?? null;
}

export async function listMcpMusicSessionRows(
  grantId: string,
  userId: string,
): Promise<McpMusicSessionRow[]> {
  return (await getSql().query(
    `SELECT * FROM mcp_music_sessions WHERE grant_id = $1 AND google_user_id = $2 AND closed_at IS NULL AND expires_at > NOW() AND max_expires_at > NOW() ORDER BY created_at DESC LIMIT 10`,
    [grantId, userId],
  )) as McpMusicSessionRow[];
}
