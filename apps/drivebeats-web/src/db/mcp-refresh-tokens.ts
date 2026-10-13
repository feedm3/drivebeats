import { getSql } from "@/db/client";

export async function saveMcpRefreshToken(token: {
  hash: string;
  grantId: string;
  scopes: string[];
  expiresAt: Date;
}) {
  await getSql().query(
    `INSERT INTO mcp_refresh_tokens (token_hash,grant_id,scopes,expires_at) VALUES ($1,$2,$3,$4)`,
    [token.hash, token.grantId, token.scopes, token.expiresAt],
  );
}
export interface McpRefreshTokenRecord {
  grant_id: string;
  expires_at: string | Date;
  scopes: string[];
  consumed_at: string | Date | null;
}

export async function getMcpRefreshToken(
  hash: string,
): Promise<McpRefreshTokenRecord | null> {
  const rows = await getSql().query<false, false>(
    `SELECT * FROM mcp_refresh_tokens WHERE token_hash=$1 AND expires_at > NOW()`,
    [hash],
  );
  return (rows[0] as McpRefreshTokenRecord | undefined) ?? null;
}
export async function consumeMcpRefreshToken(hash: string) {
  const rows = await getSql().query<false, false>(
    `UPDATE mcp_refresh_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING token_hash`,
    [hash],
  );
  return rows.length === 1;
}
