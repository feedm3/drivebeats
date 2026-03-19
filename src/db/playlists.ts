import { getSql } from "@/db/client";

export interface DbPlaylistRecord {
  id: string;
  name: string;
}

export async function countPlaylistsByUser(googleUserId: string) {
  const sql = getSql();

  const rows = (await sql.query(
    `
      SELECT COUNT(*)::integer AS playlist_count
      FROM playlists
      WHERE user_google_id = $1
    `,
    [googleUserId],
  )) as { playlist_count: number }[];

  return rows[0]?.playlist_count ?? 0;
}

export async function listPlaylistsByUser(googleUserId: string) {
  const sql = getSql();

  return (await sql.query(
    `
      SELECT id, name
      FROM playlists
      WHERE user_google_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [googleUserId],
  )) as DbPlaylistRecord[];
}

export async function listOwnedPlaylistIdsByUser(googleUserId: string) {
  const rows = await listPlaylistsByUser(googleUserId);
  return rows.map((row) => row.id);
}

export async function upsertPlaylist(params: {
  id: string;
  googleUserId: string;
  name: string;
}) {
  const sql = getSql();

  await sql.query(
    `
      INSERT INTO playlists (id, user_google_id, name, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          updated_at = NOW()
      WHERE playlists.user_google_id = EXCLUDED.user_google_id
    `,
    [params.id, params.googleUserId, params.name],
  );
}

export async function renamePlaylist(params: {
  id: string;
  googleUserId: string;
  name: string;
}) {
  const sql = getSql();

  await sql.query(
    `
      UPDATE playlists
      SET name = $3,
          updated_at = NOW()
      WHERE id = $1
        AND user_google_id = $2
    `,
    [params.id, params.googleUserId, params.name],
  );
}

export async function deletePlaylist(params: {
  id: string;
  googleUserId: string;
}) {
  const sql = getSql();

  await sql.query(
    `
      DELETE FROM playlists
      WHERE id = $1
        AND user_google_id = $2
    `,
    [params.id, params.googleUserId],
  );
}

export async function userOwnsPlaylist(params: {
  id: string;
  googleUserId: string;
}) {
  const sql = getSql();

  const rows = (await sql.query(
    `
      SELECT id
      FROM playlists
      WHERE id = $1
        AND user_google_id = $2
      LIMIT 1
    `,
    [params.id, params.googleUserId],
  )) as { id: string }[];

  return rows.length > 0;
}

export async function touchPlaylist(params: {
  id: string;
  googleUserId: string;
}) {
  const sql = getSql();

  await sql.query(
    `
      UPDATE playlists
      SET updated_at = NOW()
      WHERE id = $1
        AND user_google_id = $2
    `,
    [params.id, params.googleUserId],
  );
}
