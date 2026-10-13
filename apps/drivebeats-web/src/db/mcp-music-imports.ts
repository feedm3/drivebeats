import { getSql } from "@/db/client";

export async function insertMcpMusicImport(
  capabilityHash: string,
  sessionId: string,
): Promise<{ expires_at: string } | null> {
  const rows = (await getSql().query(
    `WITH pending AS (
      UPDATE mcp_music_sessions SET import_pending_until = LEAST(NOW() + INTERVAL '10 minutes', max_expires_at),
      expires_at = LEAST(NOW() + INTERVAL '10 minutes', max_expires_at)
      WHERE id = $2 AND closed_at IS NULL AND expires_at > NOW() AND max_expires_at > NOW()
      RETURNING id, import_pending_until)
      INSERT INTO mcp_music_imports (capability_hash,session_id,expires_at)
      SELECT $1,id,import_pending_until FROM pending RETURNING expires_at`,
    [capabilityHash, sessionId],
  )) as { expires_at: string }[];
  return rows[0] ?? null;
}

export async function findMcpMusicImport(
  capabilityHash: string,
  userId: string,
): Promise<{
  id: string;
  grant_id: string;
  google_user_id: string;
  import_expires_at: string;
} | null> {
  const rows = (await getSql().query(
    `SELECT s.*, i.expires_at AS import_expires_at FROM mcp_music_imports i JOIN mcp_music_sessions s ON s.id = i.session_id JOIN mcp_grants g ON g.id = s.grant_id WHERE i.capability_hash = $1 AND s.google_user_id = $2 AND i.consumed_at IS NULL AND i.expires_at > NOW() AND s.closed_at IS NULL AND s.expires_at > NOW() AND g.revoked_at IS NULL AND g.expires_at > NOW()`,
    [capabilityHash, userId],
  )) as {
    id: string;
    grant_id: string;
    google_user_id: string;
    import_expires_at: string;
  }[];
  return rows[0] ?? null;
}

/** Consume once and publish only deliberately selected root IDs, atomically. */
export async function consumeMcpMusicImportRow(
  capabilityHash: string,
  userId: string,
  folderIds: string[],
  trackIds: string[],
  receipt: string,
): Promise<{ id: string } | null> {
  const rows = (await getSql().query(
    `WITH consumed AS (
      UPDATE mcp_music_imports i SET consumed_at = NOW() FROM mcp_music_sessions s, mcp_grants g
      WHERE i.capability_hash = $1 AND i.session_id = s.id AND s.google_user_id = $2
      AND i.consumed_at IS NULL AND i.expires_at > NOW() AND s.closed_at IS NULL AND s.expires_at > NOW()
      AND g.id = s.grant_id AND g.revoked_at IS NULL AND g.expires_at > NOW() RETURNING i.session_id)
      UPDATE mcp_music_sessions s SET imported_folder_ids = $3, standalone_track_ids = $4, import_receipt = $5, imports_revision = imports_revision + 1, catalog_ready = false,
      import_pending_until = NULL, expires_at = LEAST(NOW() + INTERVAL '60 seconds', max_expires_at)
      FROM consumed c WHERE s.id = c.session_id AND s.closed_at IS NULL AND s.expires_at > NOW() RETURNING s.id`,
    [capabilityHash, userId, folderIds, trackIds, receipt],
  )) as { id: string }[];
  return rows[0] ?? null;
}
