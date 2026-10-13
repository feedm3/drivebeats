import { getSql } from "@/db/client";

export async function saveMcpLinkRequest(id: string, payload: string) {
  await getSql().query(
    `DELETE FROM mcp_link_requests WHERE expires_at <= NOW()`,
  );
  await getSql().query(
    `INSERT INTO mcp_link_requests (id,encrypted_payload,expires_at) VALUES ($1,$2,NOW()+INTERVAL '10 minutes')`,
    [id, payload],
  );
}
export async function getMcpLinkRequest(id: string) {
  const rows = await getSql().query<false, false>(
    `SELECT encrypted_payload FROM mcp_link_requests WHERE id=$1 AND expires_at>NOW()`,
    [id],
  );
  return rows[0]?.encrypted_payload as string | undefined;
}
export async function updateMcpLinkRequest(id: string, payload: string) {
  await getSql().query(
    `UPDATE mcp_link_requests SET encrypted_payload=$2 WHERE id=$1 AND expires_at>NOW()`,
    [id, payload],
  );
}
export async function consumeMcpLinkRequest(id: string) {
  const rows = await getSql().query<false, false>(
    `DELETE FROM mcp_link_requests WHERE id=$1 AND expires_at>NOW() RETURNING encrypted_payload`,
    [id],
  );
  return rows[0]?.encrypted_payload as string | undefined;
}
