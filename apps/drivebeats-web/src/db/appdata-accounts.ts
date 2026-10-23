import { appDataRows as rows, appDataStep as step } from "@/db/appdata-query";
import {
  type AppDataAccount,
  AppDataError,
  type AppDataIdentity,
} from "@/db/appdata-types";
export function appDataAccount(row: Record<string, unknown>): AppDataAccount {
  return {
    accountId: String(row.account_id),
    generation: String(row.generation),
    state: row.state as AppDataAccount["state"],
    source: row.source as AppDataAccount["source"],
    revision: Number(row.revision),
    migrationVersion: Number(row.migration_version),
  };
}
/** Only newly verified Google OAuth can create/recreate an incarnation. */
export async function initializeAppDataAccount(accountId: string) {
  return step(async () => {
    const result =
      await rows`INSERT INTO appdata_accounts(account_id) VALUES (${accountId})
      ON CONFLICT(account_id) DO UPDATE SET
        generation=CASE WHEN appdata_accounts.state='deleted' THEN gen_random_uuid() ELSE appdata_accounts.generation END,
        state=CASE WHEN appdata_accounts.state='deleted' THEN 'active' ELSE appdata_accounts.state END,
        source=CASE WHEN appdata_accounts.state='deleted' THEN 'legacy' ELSE appdata_accounts.source END,
        revision=CASE WHEN appdata_accounts.state='deleted' THEN 0 ELSE appdata_accounts.revision END,
        migration_version=CASE WHEN appdata_accounts.state='deleted' THEN 0 ELSE appdata_accounts.migration_version END RETURNING *`;
    return appDataAccount(result[0]);
  });
}
export async function getAppDataAccount(accountId: string) {
  return step(async () => {
    const result =
      await rows`SELECT * FROM appdata_accounts WHERE account_id=${accountId}`;
    return result[0] ? appDataAccount(result[0]) : null;
  });
}
export async function assertAppDataIdentity(identity: AppDataIdentity) {
  const value = await getAppDataAccount(identity.accountId);
  if (value?.generation === identity.generation && value.state === "deleting")
    throw new AppDataError("appdata_deletion_in_progress");
  if (
    !value ||
    value.generation !== identity.generation ||
    value.state !== "active"
  )
    throw new AppDataError("appdata_stale_session");
  return value;
}
export async function claimAppDataMigration(identity: AppDataIdentity) {
  return step(async () => {
    const result =
      await rows`UPDATE appdata_accounts SET source='migrating',updated_at=now()
      WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND state='active' AND source='legacy' RETURNING account_id`;
    return result.length > 0;
  });
}
export async function fenceAppDataAccount(identity: AppDataIdentity) {
  return step(async () => {
    const result =
      await rows`UPDATE appdata_accounts SET state='deleting',updated_at=now() WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND state IN ('active','deleting') RETURNING *`;
    if (!result.length) throw new AppDataError("appdata_stale_session");
  });
}
