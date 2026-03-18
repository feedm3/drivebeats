import type { AuthUser } from "@/lib/auth-session";
import { getSql } from "@/db/client";

export async function upsertUser(user: AuthUser) {
  const sql = getSql();

  await sql.query(
    `
      INSERT INTO users (google_user_id, email, name, picture, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (google_user_id) DO UPDATE
      SET email = EXCLUDED.email,
          name = EXCLUDED.name,
          picture = EXCLUDED.picture,
          updated_at = NOW()
    `,
    [user.id, user.email, user.name, user.picture],
  );
}

export async function deleteUserByGoogleId(googleUserId: string) {
  const sql = getSql();

  await sql.query(
    `
      DELETE FROM users
      WHERE google_user_id = $1
    `,
    [googleUserId],
  );
}
