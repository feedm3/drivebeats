import { getSql } from "@/db/client";
import type { AuthUser } from "@/lib/auth-session";

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

export async function recordUserVisit(user: AuthUser) {
  const sql = getSql();

  await sql.query(
    `
      INSERT INTO users (
        google_user_id,
        email,
        name,
        picture,
        last_visited_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      ON CONFLICT (google_user_id) DO UPDATE
      SET email = EXCLUDED.email,
          name = EXCLUDED.name,
          picture = EXCLUDED.picture,
          last_visited_at = CASE
            WHEN users.last_visited_at IS NULL
              OR users.last_visited_at < date_trunc('day', NOW())
            THEN NOW()
            ELSE users.last_visited_at
          END,
          updated_at = CASE
            WHEN users.email IS DISTINCT FROM EXCLUDED.email
              OR users.name IS DISTINCT FROM EXCLUDED.name
              OR users.picture IS DISTINCT FROM EXCLUDED.picture
              OR users.last_visited_at IS NULL
              OR users.last_visited_at < date_trunc('day', NOW())
            THEN NOW()
            ELSE users.updated_at
          END
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
