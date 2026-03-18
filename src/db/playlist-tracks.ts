import { getSql } from "@/db/client";

interface DbPlaylistTrackInsert {
  playlistId: string;
  position: number;
  fileId: string;
  fileName: string;
  mimeType: string | null;
  size: string | null;
  modifiedTime: string | null;
  parents: string[];
  parentFolderName: string | null;
}

export interface DbPlaylistTrackRecord {
  playlist_id: string;
  file_id: string;
  file_name: string;
  mime_type: string | null;
  size: string | null;
  modified_time: string | null;
  parents: string[] | null;
  parent_folder_name: string | null;
}

export async function listTracksByPlaylistIds(playlistIds: string[]) {
  if (playlistIds.length === 0) {
    return [] as DbPlaylistTrackRecord[];
  }

  const sql = getSql();

  return (await sql.query(
    `
      SELECT
        playlist_id,
        file_id,
        file_name,
        mime_type,
        size,
        modified_time,
        parents,
        parent_folder_name
      FROM playlist_tracks
      WHERE playlist_id = ANY($1::text[])
      ORDER BY playlist_id ASC, position ASC, file_id ASC
    `,
    [playlistIds],
  )) as DbPlaylistTrackRecord[];
}

export async function listTrackFileIdsByPlaylist(playlistId: string) {
  const sql = getSql();

  return (await sql.query(
    `
      SELECT file_id
      FROM playlist_tracks
      WHERE playlist_id = $1
    `,
    [playlistId],
  )) as { file_id: string }[];
}

export async function getNextPlaylistTrackPosition(playlistId: string) {
  const sql = getSql();

  const rows = (await sql.query(
    `
      SELECT COALESCE(MAX(position), -1) + 1 AS next_position
      FROM playlist_tracks
      WHERE playlist_id = $1
    `,
    [playlistId],
  )) as { next_position: number }[];

  return rows[0]?.next_position ?? 0;
}

export async function insertPlaylistTracks(records: DbPlaylistTrackInsert[]) {
  if (records.length === 0) {
    return;
  }

  const sql = getSql();
  const values: unknown[] = [];
  const tuples = records.map((record, index) => {
    const offset = index * 9;
    values.push(
      record.playlistId,
      record.position,
      record.fileId,
      record.fileName,
      record.mimeType,
      record.size,
      record.modifiedTime,
      record.parents,
      record.parentFolderName,
    );

    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
  });

  await sql.query(
    `
      INSERT INTO playlist_tracks (
        playlist_id,
        position,
        file_id,
        file_name,
        mime_type,
        size,
        modified_time,
        parents,
        parent_folder_name
      )
      VALUES ${tuples.join(", ")}
      ON CONFLICT (playlist_id, file_id) DO NOTHING
    `,
    values,
  );
}

export async function deletePlaylistTrack(params: {
  playlistId: string;
  fileId: string;
}) {
  const sql = getSql();

  await sql.query(
    `
      DELETE FROM playlist_tracks
      WHERE playlist_id = $1
        AND file_id = $2
    `,
    [params.playlistId, params.fileId],
  );
}

export async function reorderPlaylistTracks(params: {
  playlistId: string;
  fileIds: string[];
}) {
  if (params.fileIds.length === 0) {
    return;
  }

  const sql = getSql();
  const values: unknown[] = [];
  const cases = params.fileIds.map((fileId, index) => {
    const offset = index * 2;
    values.push(fileId, index);
    return `WHEN $${offset + 1} THEN $${offset + 2}::integer`;
  });
  const playlistIdParam = values.length + 1;
  const fileIdsParam = values.length + 2;

  await sql.query(
    `
      UPDATE playlist_tracks
      SET position = CASE file_id
        ${cases.join("\n        ")}
        ELSE position
      END,
          updated_at = NOW()
      WHERE playlist_id = $${playlistIdParam}
        AND file_id = ANY($${fileIdsParam}::text[])
    `,
    [...values, params.playlistId, params.fileIds],
  );
}
