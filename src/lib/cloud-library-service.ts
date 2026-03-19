import {
  deleteAllNonFavoriteTracks,
  deleteNonFavoriteTrack,
  listFavoriteTracksByUser,
  upsertFavoriteTrack,
} from "@/db/favorite-tracks";
import {
  deletePlaylistTrack,
  getNextPlaylistTrackPosition,
  insertPlaylistTracks,
  listTrackFileIdsByPlaylist,
  listTracksByPlaylistIds,
  reorderPlaylistTracks,
} from "@/db/playlist-tracks";
import {
  countPlaylistsByUser,
  deletePlaylist,
  listOwnedPlaylistIdsByUser,
  listPlaylistsByUser,
  renamePlaylist,
  touchPlaylist,
  upsertPlaylist,
  userOwnsPlaylist,
} from "@/db/playlists";
import {
  batchUpsertTrackMetadata,
  listTrackMetadataByFileIds,
  pruneOrphanedTrackMetadata,
} from "@/db/track-metadata";
import { deleteUserByGoogleId, recordUserVisit, upsertUser } from "@/db/users";
import type { AuthUser } from "@/lib/auth-session";
import type { CloudLibrarySyncPayload } from "@/lib/cloud-library-shared";
import {
  getPlaylistLimitError,
  getRemainingPlaylistTrackSlots,
  MAX_PLAYLISTS_PER_USER,
  MAX_TRACKS_PER_PLAYLIST,
  PLAYLIST_COUNT_LIMIT_CODE,
  PlaylistLimitError,
} from "@/lib/playlist-limits";
import type { Playlist, PlaylistTrack } from "@/types";

function normalizeTrack(track: PlaylistTrack) {
  return {
    fileId: track.fileId,
    fileName: track.fileName,
    mimeType: track.mimeType ?? null,
    size: track.size ?? null,
    modifiedTime: track.modifiedTime ?? null,
    parents: track.parents ?? [],
    parentFolderName: track.parentFolderName ?? null,
  };
}

function rowToTrack(
  row:
    | Awaited<ReturnType<typeof listTracksByPlaylistIds>>[number]
    | Awaited<ReturnType<typeof listFavoriteTracksByUser>>[number],
): PlaylistTrack {
  return {
    fileId: row.file_id,
    fileName: row.file_name,
    mimeType: row.mime_type ?? undefined,
    size: row.size ?? undefined,
    modifiedTime: row.modified_time ?? undefined,
    parents: row.parents ?? undefined,
    parentFolderName: row.parent_folder_name ?? undefined,
  };
}

async function ensureUserRecord(user: AuthUser) {
  await upsertUser(user);
}

export async function getCloudLibrarySyncPayload(
  user: AuthUser,
): Promise<CloudLibrarySyncPayload> {
  await recordUserVisit(user);

  const [playlists, favoriteRows] = await Promise.all([
    listPlaylistsByUser(user.id),
    listFavoriteTracksByUser(user.id),
  ]);
  const playlistIds = playlists.map((playlist) => playlist.id);
  const playlistTrackRows = await listTracksByPlaylistIds(playlistIds);
  const tracksByPlaylistId = new Map<string, PlaylistTrack[]>();

  for (const row of playlistTrackRows) {
    const tracks = tracksByPlaylistId.get(row.playlist_id) ?? [];
    tracks.push(rowToTrack(row));
    tracksByPlaylistId.set(row.playlist_id, tracks);
  }

  // Collect all synced file IDs for metadata lookup
  const allFileIds = new Set<string>();
  for (const row of playlistTrackRows) {
    allFileIds.add(row.file_id);
  }
  for (const row of favoriteRows) {
    allFileIds.add(row.file_id);
  }

  const metadataRows = await listTrackMetadataByFileIds(user.id, [
    ...allFileIds,
  ]);
  const trackMetadata: Record<
    string,
    {
      title?: string;
      artist?: string;
      album?: string;
      modifiedTime?: string;
    }
  > = {};
  for (const row of metadataRows) {
    const entry: {
      title?: string;
      artist?: string;
      album?: string;
      modifiedTime?: string;
    } = {};
    if (row.id3_title) entry.title = row.id3_title;
    if (row.id3_artist) entry.artist = row.id3_artist;
    if (row.id3_album) entry.album = row.id3_album;
    if (row.file_modified_time) entry.modifiedTime = row.file_modified_time;
    if (entry.title || entry.artist || entry.album) {
      trackMetadata[row.file_id] = entry;
    }
  }

  return {
    playlists: playlists.map(
      (playlist): Playlist => ({
        id: playlist.id,
        name: playlist.name,
        tracks: tracksByPlaylistId.get(playlist.id) ?? [],
      }),
    ),
    favorites: favoriteRows.map(rowToTrack),
    trackMetadata:
      Object.keys(trackMetadata).length > 0 ? trackMetadata : undefined,
  };
}

export async function createPlaylistRecord(
  user: AuthUser,
  playlist: Pick<Playlist, "id" | "name">,
) {
  await ensureUserRecord(user);
  const playlistCount = await countPlaylistsByUser(user.id);
  if (playlistCount >= MAX_PLAYLISTS_PER_USER) {
    throw new PlaylistLimitError(PLAYLIST_COUNT_LIMIT_CODE);
  }

  try {
    await upsertPlaylist({
      id: playlist.id,
      googleUserId: user.id,
      name: playlist.name,
    });
  } catch (error) {
    throw getPlaylistLimitError(error) ?? error;
  }
}

export async function renamePlaylistRecord(
  user: AuthUser,
  playlistId: string,
  name: string,
) {
  await renamePlaylist({
    id: playlistId,
    googleUserId: user.id,
    name,
  });
}

export async function deletePlaylistRecord(user: AuthUser, playlistId: string) {
  await deletePlaylist({
    id: playlistId,
    googleUserId: user.id,
  });
  await pruneOrphanedTrackMetadata(user.id);
}

export async function addPlaylistTracksRecords(
  user: AuthUser,
  playlistId: string,
  tracks: PlaylistTrack[],
) {
  if (tracks.length === 0) {
    return {
      addedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      reachedTrackLimit: false,
    };
  }

  const ownsPlaylist = await userOwnsPlaylist({
    id: playlistId,
    googleUserId: user.id,
  });
  if (!ownsPlaylist) {
    throw new Error("Playlist not found");
  }

  const [existingRows, nextPosition] = await Promise.all([
    listTrackFileIdsByPlaylist(playlistId),
    getNextPlaylistTrackPosition(playlistId),
  ]);
  const existingIds = new Set(existingRows.map((row) => row.file_id));
  const uniqueTracks = tracks
    .map(normalizeTrack)
    .filter((track) => !existingIds.has(track.fileId));
  const duplicateCount = tracks.length - uniqueTracks.length;
  const remainingSlots = getRemainingPlaylistTrackSlots(existingRows.length);
  const tracksToInsert = uniqueTracks.slice(0, remainingSlots);

  if (tracksToInsert.length === 0) {
    await touchPlaylist({ id: playlistId, googleUserId: user.id });
    return {
      addedCount: 0,
      duplicateCount,
      skippedCount: uniqueTracks.length,
      reachedTrackLimit: existingRows.length >= MAX_TRACKS_PER_PLAYLIST,
    };
  }

  try {
    await insertPlaylistTracks(
      tracksToInsert.map((track, index) => ({
        playlistId,
        position: nextPosition + index,
        fileId: track.fileId,
        fileName: track.fileName,
        mimeType: track.mimeType,
        size: track.size,
        modifiedTime: track.modifiedTime,
        parents: track.parents,
        parentFolderName: track.parentFolderName,
      })),
    );
  } catch (error) {
    throw getPlaylistLimitError(error) ?? error;
  }

  await touchPlaylist({ id: playlistId, googleUserId: user.id });

  const nextTrackCount = existingRows.length + tracksToInsert.length;

  return {
    addedCount: tracksToInsert.length,
    duplicateCount,
    skippedCount: uniqueTracks.length - tracksToInsert.length,
    reachedTrackLimit: nextTrackCount >= MAX_TRACKS_PER_PLAYLIST,
  };
}

export async function removePlaylistTrackRecord(
  user: AuthUser,
  playlistId: string,
  fileId: string,
) {
  const ownsPlaylist = await userOwnsPlaylist({
    id: playlistId,
    googleUserId: user.id,
  });
  if (!ownsPlaylist) {
    return;
  }

  await deletePlaylistTrack({ playlistId, fileId });
  await touchPlaylist({ id: playlistId, googleUserId: user.id });
  await pruneOrphanedTrackMetadata(user.id);
}

export async function reorderPlaylistTracksRecords(
  user: AuthUser,
  playlistId: string,
  fileIds: string[],
) {
  const ownsPlaylist = await userOwnsPlaylist({
    id: playlistId,
    googleUserId: user.id,
  });
  if (!ownsPlaylist || fileIds.length === 0) {
    return;
  }

  const existingRows = await listTrackFileIdsByPlaylist(playlistId);
  if (existingRows.length !== fileIds.length) {
    throw new Error("Invalid reorder payload");
  }

  const existingIds = new Set(existingRows.map((row) => row.file_id));
  if (fileIds.some((fileId) => !existingIds.has(fileId))) {
    throw new Error("Invalid reorder payload");
  }

  await reorderPlaylistTracks({ playlistId, fileIds });
  await touchPlaylist({ id: playlistId, googleUserId: user.id });
}

export async function setFavoriteTrackRecord(
  user: AuthUser,
  track: PlaylistTrack,
  isFavorite: boolean,
) {
  await ensureUserRecord(user);
  const normalized = normalizeTrack(track);

  await upsertFavoriteTrack({
    googleUserId: user.id,
    fileId: normalized.fileId,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    size: normalized.size,
    modifiedTime: normalized.modifiedTime,
    parents: normalized.parents,
    parentFolderName: normalized.parentFolderName,
    isFavorite,
  });

  if (!isFavorite) {
    await deleteNonFavoriteTrack({
      googleUserId: user.id,
      fileId: normalized.fileId,
    });
    await pruneOrphanedTrackMetadata(user.id);
  }
}

export async function deleteAllCloudLibraryData(user: AuthUser) {
  await deleteUserByGoogleId(user.id);
}

export async function seedCloudLibraryData(
  user: AuthUser,
  data: CloudLibrarySyncPayload,
) {
  await ensureUserRecord(user);
  const existingPlaylistIds = await listOwnedPlaylistIdsByUser(user.id);
  if (existingPlaylistIds.length > 0) {
    return;
  }

  for (const playlist of data.playlists) {
    try {
      await createPlaylistRecord(user, playlist);
    } catch (error) {
      if (getPlaylistLimitError(error)?.code === PLAYLIST_COUNT_LIMIT_CODE) {
        break;
      }

      throw error;
    }

    await addPlaylistTracksRecords(user, playlist.id, playlist.tracks);
  }

  for (const favorite of data.favorites) {
    await setFavoriteTrackRecord(user, favorite, true);
  }

  await deleteAllNonFavoriteTracks(user.id);

  // Seed any ID3 metadata sent with the bootstrap payload
  if (data.trackMetadata && Object.keys(data.trackMetadata).length > 0) {
    const metadataRecords = Object.entries(data.trackMetadata).map(
      ([fileId, meta]) => ({
        fileId,
        fileModifiedTime: meta.modifiedTime,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
      }),
    );
    await batchUpsertTrackMetadata(user.id, metadataRecords);
  }
}
