import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import {
  claimAppDataMigration,
  getAppDataAccount,
  isAppDataLegacySourceAvailable,
} from "@/db/appdata-control";
import { getSql } from "@/db/client";
import { getAppDataContext } from "@/lib/appdata-context";
import { appDataControl } from "@/lib/appdata-control-service";
import type { AuthSession, AuthUser } from "@/lib/auth-session";
import type { CloudLibrarySyncPayload } from "@/lib/cloud-library-shared";
import {
  applyCollectionCommand,
  type CollectionCommand,
  CollectionCommandError,
  type CollectionResult,
} from "@/lib/collection-commands";
import type { Playlist, PlaylistTrack } from "@/types";

const emptyLibrary = (): CloudLibrarySyncPayload => ({
  playlists: [],
  favorites: [],
});

/** Only the most recent verified snapshot is authoritative; tags/roots have separate histories. */
export function readCollections(
  envelopes: { kind: string; revision: number; payload: unknown }[],
): CloudLibrarySyncPayload {
  const saved = envelopes
    .filter(
      (entry) => entry.kind === "collections" || entry.kind === "migration",
    )
    .sort((a, b) => b.revision - a.revision)[0];
  if (!saved)
    throw new Error("Drive collections are unavailable; reconnect to recover");
  const value = saved.payload as CloudLibrarySyncPayload;
  return { playlists: value.playlists, favorites: value.favorites };
}

/** One database statement supplies a consistent legacy snapshot after its writers have been fenced. */
async function readLegacyLibrary(
  accountId: string,
): Promise<CloudLibrarySyncPayload> {
  const rows = await getSql().query(
    `SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'tracks',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fileId',t.file_id,'fileName',t.file_name,'mimeType',t.mime_type,'size',t.size,'modifiedTime',t.modified_time,'parents',t.parents,'parentFolderName',t.parent_folder_name) ORDER BY t.position,t.file_id) FROM playlist_tracks t WHERE t.playlist_id=p.id),'[]'::jsonb)) ORDER BY p.created_at ASC,p.id ASC) FROM playlists p WHERE p.user_google_id=$1),'[]'::jsonb) AS playlists,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('fileId',f.file_id,'fileName',f.file_name,'mimeType',f.mime_type,'size',f.size,'modifiedTime',f.modified_time,'parents',f.parents,'parentFolderName',f.parent_folder_name) ORDER BY LOWER(f.file_name) ASC,f.file_id ASC) FROM favorite_tracks f WHERE f.user_google_id=$1 AND f.is_favorite=TRUE),'[]'::jsonb) AS favorites`,
    [accountId],
  );
  // SQL JSON contains nullable descriptor columns; the portable schema uses omissions.
  const first = (rows as Record<string, unknown>[])[0];
  return JSON.parse(
    JSON.stringify(first, (_key, value) =>
      value === null ? undefined : value,
    ),
  ) as CloudLibrarySyncPayload;
}

export async function bootstrapAppData(user: AuthUser) {
  const { identity, service } = await getAppDataContext(user, true);
  let saved = await service.readCollections(identity);
  let legacyUnavailable = saved.envelopes.some(
    (entry) =>
      entry.kind === "migration" &&
      entry.operationId.startsWith("migration-empty-v1-"),
  );
  if (saved.source !== "drive") {
    await claimAppDataMigration(identity);
    // A stable operation ID prevents retries or concurrent fresh logins from importing twice.
    const isReset = saved.migrationVersion === -1;
    const eligibleLegacy = !isReset && (await isAppDataLegacySourceAvailable());
    legacyUnavailable = !isReset && !eligibleLegacy;
    const operationId = `migration-${isReset ? "reset" : eligibleLegacy ? "legacy" : "empty"}-v1-${identity.generation}`;
    const payload = eligibleLegacy
      ? await readLegacyLibrary(user.id)
      : emptyLibrary();
    const pendingMigration = saved.pendingOperations.find(
      (op) => op.operationId === operationId,
    );
    try {
      await service.append(identity, {
        operationId,
        kind: "migration",
        baseRevision: pendingMigration
          ? pendingMigration.revision - 1
          : saved.revision,
        payload,
      });
    } catch (error) {
      // Another browser may have completed exactly this migration while we read.
      saved = await service.readCollections(identity);
      if (saved.source !== "drive") throw error;
    }
    saved = await service.readCollections(identity);
  }
  readCollections(saved.envelopes);
  return {
    ready: true,
    generation: saved.generation,
    migrationVersion: saved.migrationVersion,
    source: saved.source,
    cutoff: saved.cutoff,
    legacyUnavailable,
  };
}

export async function getCloudLibrarySyncPayload(
  user: AuthUser,
): Promise<CloudLibrarySyncPayload> {
  const { identity, service } = await getAppDataContext(user);
  return readCollections((await service.readCollections(identity)).envelopes);
}

async function mutate(
  user: AuthUser,
  command: CollectionCommand,
): Promise<CollectionResult> {
  const { identity, service } = await getAppDataContext(user);
  const requestHeaders = await headers();
  if (requestHeaders.get("X-DriveBeats-Generation") !== identity.generation)
    throw new CollectionCommandError(
      "appdata_stale_session",
      "Account changed; reconnect before retrying",
      403,
    );
  const incomingId = requestHeaders.get("X-DriveBeats-Operation");
  let operationId =
    incomingId && /^[a-zA-Z0-9_-]{1,128}$/.test(incomingId)
      ? incomingId
      : randomUUID();
  const commandHash = createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
  let cancelledHops = 0;
  for (let attempt = 0; attempt < 8; ) {
    const receipt = await service.getOperation(identity, operationId);
    if (receipt && receipt.commandHash !== commandHash)
      throw new CollectionCommandError(
        "appdata_operation_conflict",
        "Operation identifier was already used",
        422,
      );
    if (receipt?.status === "cancelled") {
      // A never-started reservation may be fenced by a later writer. Keep a
      // deterministic successor so retries of the original request find the
      // same durable result, while the old reservation stays fenced.
      operationId = createHash("sha256")
        .update(`${operationId}:cancelled:${receipt.revision}`)
        .digest("hex");
      if (++cancelledHops >= 8)
        throw new CollectionCommandError(
          "appdata_operation_resume",
          "Your saved change is being resumed. Retry shortly.",
          409,
          operationId,
        );
      continue;
    }
    if (receipt && ["committed", "superseded"].includes(receipt.status))
      return receipt.result ?? {};
    const saved = await service.readCollections(identity);
    const { payload, result } = applyCollectionCommand(
      readCollections(saved.envelopes),
      command,
    );
    try {
      await service.append(identity, {
        operationId,
        kind: "collections",
        baseRevision: receipt ? receipt.revision - 1 : saved.revision,
        payload: { ...payload, commandHash, result },
      });
      return result;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
      attempt++;
      if (error.code === "appdata_pending_write") {
        // Background tag saves share the durable account fence. Give the
        // current upload time to finish, then reapply intent to fresh state.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(250 * attempt, 1000)),
        );
      } else if (error.code !== "appdata_revision_conflict") throw error;
    }
  }
  throw new CollectionCommandError(
    "appdata_pending_write",
    "Your Library is saving another change. Retry shortly.",
    409,
    cancelledHops > 0 ? operationId : undefined,
  );
}

export async function createPlaylistRecord(
  user: AuthUser,
  playlist: Pick<Playlist, "id" | "name">,
) {
  await mutate(user, { type: "create", ...playlist, tracks: [] });
}
export async function createPlaylistWithTracksRecord(
  user: AuthUser,
  playlist: Pick<Playlist, "id" | "name">,
  tracks: PlaylistTrack[],
) {
  const result = await mutate(user, { type: "create", ...playlist, tracks });
  return { trackCount: result.trackCount ?? 0 };
}
export async function renamePlaylistRecord(
  user: AuthUser,
  id: string,
  name: string,
) {
  await mutate(user, { type: "rename", id, name });
}
export async function deletePlaylistRecord(user: AuthUser, id: string) {
  await mutate(user, { type: "delete", id });
}
export async function addPlaylistTracksRecords(
  user: AuthUser,
  id: string,
  tracks: PlaylistTrack[],
) {
  const result = await mutate(user, { type: "add", id, tracks });
  return {
    addedCount: result.addedCount ?? 0,
    duplicateCount: result.duplicateCount ?? 0,
    skippedCount: result.skippedCount ?? 0,
    reachedTrackLimit: result.reachedTrackLimit ?? false,
  };
}
export async function removePlaylistTrackRecord(
  user: AuthUser,
  id: string,
  fileId: string,
) {
  await mutate(user, { type: "remove", id, fileId });
}
export async function reorderPlaylistTracksRecords(
  user: AuthUser,
  id: string,
  fileIds: string[],
) {
  await mutate(user, { type: "reorder", id, fileIds });
}
export async function setFavoriteTrackRecord(
  user: AuthUser,
  track: PlaylistTrack,
  enabled: boolean,
) {
  await mutate(user, { type: "favorite", track, enabled });
}

export async function deleteAllCloudLibraryData(user: AuthUser) {
  const { identity, service } = await getAppDataContext(user, true);
  await service.delete(identity);
  // Keep encrypted credentials and user records on any incomplete Drive cleanup.
  await appDataControl.finishDeletion(identity);
}

export async function hasDeletedCloudLibraryData(session: AuthSession | null) {
  if (!session?.accountGeneration) return false;
  const account = await getAppDataAccount(session.user.id);
  return (
    account?.state === "deleted" &&
    account.generation === session.accountGeneration
  );
}

export async function resetCloudLibraryData(user: AuthUser) {
  const { identity, service } = await getAppDataContext(user, true);
  return service.reset(identity);
}

/** Old clients must never resurrect deleted/retired collections from local snapshots. */
export async function seedCloudLibraryData(
  _user: AuthUser,
  _data: CloudLibrarySyncPayload,
) {
  return;
}
