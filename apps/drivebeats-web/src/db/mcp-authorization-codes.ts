import { getSql } from "@/db/client";

export async function saveMcpAuthorizationCode(code: {
  hash: string;
  grantId: string;
  redirectUri: string;
  challenge: string;
  expiresAt: Date;
}) {
  await getSql().query(
    `INSERT INTO mcp_authorization_codes (code_hash,grant_id,redirect_uri,code_challenge,expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [code.hash, code.grantId, code.redirectUri, code.challenge, code.expiresAt],
  );
}
export interface McpAuthorizationCodeRecord {
  grant_id: string;
  expires_at: string | Date;
  redirect_uri: string;
  code_challenge: string;
}

export async function getMcpAuthorizationCode(
  hash: string,
): Promise<McpAuthorizationCodeRecord | null> {
  const rows = await getSql().query<false, false>(
    `SELECT * FROM mcp_authorization_codes WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at > NOW()`,
    [hash],
  );
  return (rows[0] as McpAuthorizationCodeRecord | undefined) ?? null;
}
export async function consumeMcpAuthorizationCode(hash: string) {
  const rows = await getSql().query<false, false>(
    `UPDATE mcp_authorization_codes SET consumed_at=NOW() WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING code_hash`,
    [hash],
  );
  return rows.length === 1;
}
