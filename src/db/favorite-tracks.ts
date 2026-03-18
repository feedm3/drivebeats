import { getSql } from "@/db/client";

interface DbFavoriteTrackUpsert {
  googleUserId: string;
  fileId: string;
  fileName: string;
  mimeType: string | null;
  size: string | null;
  modifiedTime: string | null;
  parents: string[];
  parentFolderName: string | null;
  isFavorite: boolean;
}

export interface DbFavoriteTrackRecord {
  file_id: string;
  file_name: string;
  mime_type: string | null;
  size: string | null;
  modified_time: string | null;
  parents: string[] | null;
  parent_folder_name: string | null;
}

export async function listFavoriteTracksByUser(googleUserId: string) {
  const sql = getSql();

  return (await sql.query(
    `
      SELECT
        file_id,
        file_name,
        mime_type,
        size,
        modified_time,
        parents,
        parent_folder_name
      FROM favorite_tracks
      WHERE user_google_id = $1
        AND is_favorite = TRUE
      ORDER BY LOWER(file_name) ASC, file_id ASC
    `,
    [googleUserId],
  )) as DbFavoriteTrackRecord[];
}

export async function upsertFavoriteTrack(record: DbFavoriteTrackUpsert) {
  const sql = getSql();

  await sql.query(
    `
      INSERT INTO favorite_tracks (
        user_google_id,
        file_id,
        file_name,
        mime_type,
        size,
        modified_time,
        parents,
        parent_folder_name,
        is_favorite,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_google_id, file_id) DO UPDATE
      SET file_name = EXCLUDED.file_name,
          mime_type = EXCLUDED.mime_type,
          size = EXCLUDED.size,
          modified_time = EXCLUDED.modified_time,
          parents = EXCLUDED.parents,
          parent_folder_name = EXCLUDED.parent_folder_name,
          is_favorite = EXCLUDED.is_favorite,
          updated_at = NOW()
    `,
    [
      record.googleUserId,
      record.fileId,
      record.fileName,
      record.mimeType,
      record.size,
      record.modifiedTime,
      record.parents,
      record.parentFolderName,
      record.isFavorite,
    ],
  );
}

export async function deleteNonFavoriteTrack(params: {
  googleUserId: string;
  fileId: string;
}) {
  const sql = getSql();

  await sql.query(
    `
      DELETE FROM favorite_tracks
      WHERE user_google_id = $1
        AND file_id = $2
        AND is_favorite = FALSE
    `,
    [params.googleUserId, params.fileId],
  );
}

export async function deleteAllNonFavoriteTracks(googleUserId: string) {
  const sql = getSql();

  await sql.query(
    `
      DELETE FROM favorite_tracks
      WHERE user_google_id = $1
        AND is_favorite = FALSE
    `,
    [googleUserId],
  );
}
