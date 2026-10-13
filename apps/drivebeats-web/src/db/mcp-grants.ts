import { getSql } from "@/db/client";
import type { AuthUser } from "@/lib/auth-session";

export interface McpGrant {
  id: string;
  googleUserId: string;
  clientId: string;
  profile: AuthUser;
  scopes: string[];
  encryptedGoogleRefreshToken: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function createMcpGrant(grant: Omit<McpGrant, "revokedAt">) {
  await getSql().query(
    `INSERT INTO mcp_grants (id, google_user_id, client_id, scopes, encrypted_google_refresh_token, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      grant.id,
      grant.googleUserId,
      grant.clientId,
      grant.scopes,
      grant.encryptedGoogleRefreshToken,
      grant.expiresAt,
    ],
  );
}

export async function getMcpGrant(id: string): Promise<McpGrant | null> {
  const rows = await getSql().query<false, false>(
    `SELECT g.*, u.email, u.name, u.picture FROM mcp_grants g JOIN users u ON u.google_user_id = g.google_user_id WHERE g.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    googleUserId: row.google_user_id,
    clientId: row.client_id,
    profile: {
      id: row.google_user_id,
      email: row.email,
      name: row.name,
      picture: row.picture,
    },
    scopes: row.scopes,
    encryptedGoogleRefreshToken: row.encrypted_google_refresh_token,
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

export async function revokeMcpGrant(id: string, googleUserId?: string) {
  await getSql().query(
    `UPDATE mcp_grants SET revoked_at = COALESCE(revoked_at,NOW()), encrypted_google_refresh_token = NULL WHERE id=$1 AND ($2::text IS NULL OR google_user_id=$2)`,
    [id, googleUserId ?? null],
  );
}

export async function updateMcpGoogleCredential(
  id: string,
  encryptedToken: string,
) {
  await getSql().query(
    `UPDATE mcp_grants SET encrypted_google_refresh_token=$2 WHERE id=$1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [id, encryptedToken],
  );
}

export async function clearExpiredMcpCredentials() {
  await getSql().query(
    `UPDATE mcp_grants SET encrypted_google_refresh_token=NULL WHERE encrypted_google_refresh_token IS NOT NULL AND (expires_at <= NOW() OR revoked_at IS NOT NULL)`,
  );
}
