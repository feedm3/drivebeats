import { getSql } from "@/db/client";

export async function getGoogleOAuthGrant(googleUserId: string) {
  const rows = (await getSql().query(
    "SELECT encrypted_refresh_token FROM google_oauth_grants WHERE google_user_id = $1",
    [googleUserId],
  )) as { encrypted_refresh_token: string }[];
  return rows[0]?.encrypted_refresh_token ?? null;
}

export async function saveGoogleOAuthGrant(
  googleUserId: string,
  encryptedRefreshToken: string,
) {
  await getSql().query(
    `INSERT INTO google_oauth_grants (google_user_id, encrypted_refresh_token)
     VALUES ($1, $2)
     ON CONFLICT (google_user_id) DO UPDATE
     SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, updated_at = NOW()`,
    [googleUserId, encryptedRefreshToken],
  );
}

export async function deleteGoogleOAuthGrant(googleUserId: string) {
  await getSql().query(
    "DELETE FROM google_oauth_grants WHERE google_user_id = $1",
    [googleUserId],
  );
}
