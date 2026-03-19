import { getSql } from "@/db/client";

export interface DbTrackMetadataRecord {
  file_id: string;
  file_modified_time: string | null;
  id3_title: string | null;
  id3_artist: string | null;
  id3_album: string | null;
}

interface TrackMetadataUpsert {
  fileId: string;
  fileModifiedTime?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}

export async function listTrackMetadataByFileIds(
  googleUserId: string,
  fileIds: string[],
): Promise<DbTrackMetadataRecord[]> {
  if (fileIds.length === 0) return [];

  const sql = getSql();

  return (await sql.query(
    `
      SELECT file_id, file_modified_time, id3_title, id3_artist, id3_album
      FROM track_metadata
      WHERE user_google_id = $1
        AND file_id = ANY($2)
    `,
    [googleUserId, fileIds],
  )) as DbTrackMetadataRecord[];
}

export async function batchUpsertTrackMetadata(
  googleUserId: string,
  records: TrackMetadataUpsert[],
) {
  if (records.length === 0) return;

  const sql = getSql();

  const values: unknown[] = [];
  const rows: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const offset = i * 6;
    rows.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, NOW())`,
    );
    values.push(
      googleUserId,
      record.fileId,
      record.fileModifiedTime ?? null,
      record.title ?? null,
      record.artist ?? null,
      record.album ?? null,
    );
  }

  await sql.query(
    `
      INSERT INTO track_metadata (
        user_google_id, file_id, file_modified_time,
        id3_title, id3_artist, id3_album, extracted_at
      )
      VALUES ${rows.join(", ")}
      ON CONFLICT (user_google_id, file_id) DO UPDATE
      SET file_modified_time = EXCLUDED.file_modified_time,
          id3_title = EXCLUDED.id3_title,
          id3_artist = EXCLUDED.id3_artist,
          id3_album = EXCLUDED.id3_album,
          extracted_at = NOW()
    `,
    values,
  );
}

export async function pruneOrphanedTrackMetadata(googleUserId: string) {
  const sql = getSql();

  await sql.query(
    `
      DELETE FROM track_metadata tm
      WHERE tm.user_google_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM playlist_tracks pt
          JOIN playlists p ON p.id = pt.playlist_id
          WHERE p.user_google_id = $1 AND pt.file_id = tm.file_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM favorite_tracks ft
          WHERE ft.user_google_id = $1
            AND ft.file_id = tm.file_id
            AND ft.is_favorite = TRUE
        )
    `,
    [googleUserId],
  );
}
