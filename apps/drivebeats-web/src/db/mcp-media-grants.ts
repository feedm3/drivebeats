import { getSql } from "@/db/client";

export interface McpMediaGrant {
  capabilityHash: string;
  grantId: string;
  googleUserId: string;
  fileId: string;
  mimeType: string;
  expiresAt: Date;
}

export async function insertMcpMediaGrant(grant: McpMediaGrant) {
  await getSql().query(
    `INSERT INTO mcp_media_grants
      (capability_hash, grant_id, google_user_id, file_id, mime_type, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      grant.capabilityHash,
      grant.grantId,
      grant.googleUserId,
      grant.fileId,
      grant.mimeType,
      grant.expiresAt.toISOString(),
    ],
  );
}

export async function getMcpMediaGrant(
  capabilityHash: string,
): Promise<McpMediaGrant | null> {
  const rows = (await getSql().query(
    `SELECT capability_hash, grant_id, google_user_id, file_id, mime_type, expires_at
      FROM mcp_media_grants WHERE capability_hash = $1 AND expires_at > NOW()`,
    [capabilityHash],
  )) as {
    capability_hash: string;
    grant_id: string;
    google_user_id: string;
    file_id: string;
    mime_type: string;
    expires_at: string;
  }[];
  const row = rows[0];
  return row
    ? {
        capabilityHash: row.capability_hash,
        grantId: row.grant_id,
        googleUserId: row.google_user_id,
        fileId: row.file_id,
        mimeType: row.mime_type,
        expiresAt: new Date(row.expires_at),
      }
    : null;
}
