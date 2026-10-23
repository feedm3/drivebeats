import { appDataRows as rows, appDataStep as step } from "@/db/appdata-query";
import type { AppDataIdentity, AppDataOperation } from "@/db/appdata-types";
export function appDataOperation(
  row: Record<string, unknown>,
): AppDataOperation {
  return {
    accountId: String(row.account_id),
    generation: String(row.generation),
    operationId: String(row.operation_id),
    revision: Number(row.revision),
    kind: row.kind as AppDataOperation["kind"],
    bodyHash: String(row.body_hash),
    fileId: String(row.file_id),
    bytes: Number(row.bytes),
    status: row.status as AppDataOperation["status"],
    unresolvedUpload: Boolean(row.unresolved_upload),
    savedAt: row.saved_at ? new Date(String(row.saved_at)).toISOString() : null,
    ...(row.command_hash
      ? {
          commandHash: String(row.command_hash),
          commandResult: row.command_result as Record<string, number | boolean>,
        }
      : {}),
  };
}
export async function listAppDataOperations(identity: AppDataIdentity) {
  return step(async () => {
    const result =
      await rows`SELECT * FROM appdata_operations WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND status NOT IN ('superseded','cancelled') ORDER BY revision`;
    return result.map(appDataOperation);
  });
}
export async function findAppDataOperation(
  identity: AppDataIdentity,
  operationId: string,
) {
  return step(async () => {
    const result =
      await rows`SELECT * FROM appdata_operations WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND operation_id=${operationId}`;
    return result[0] ? appDataOperation(result[0]) : null;
  });
}
export async function listPendingAppDataOperations(identity: AppDataIdentity) {
  return step(async () => {
    const result =
      await rows`SELECT * FROM appdata_operations WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND (status IN ('reserved','uploading','uncertain') OR unresolved_upload) ORDER BY revision`;
    return result.map(appDataOperation);
  });
}
export async function listPrunableAppDataOperations(identity: AppDataIdentity) {
  return step(async () => {
    const result =
      await rows`SELECT * FROM appdata_operations WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND status IN ('superseded','cancelled') AND NOT file_deleted AND NOT unresolved_upload ORDER BY revision LIMIT 1000`;
    return result.map(appDataOperation);
  });
}
export async function listAccountPendingAppDataOperations(
  identity: AppDataIdentity,
) {
  return step(async () => {
    const result =
      await rows`SELECT * FROM appdata_operations WHERE account_id=${identity.accountId} AND (status IN ('uploading','uncertain') OR unresolved_upload) ORDER BY generation,revision`;
    return result.map(appDataOperation);
  });
}
export async function markAppDataOperationPruned(
  identity: AppDataIdentity,
  operationId: string,
) {
  return step(async () => {
    await rows`UPDATE appdata_operations SET file_deleted=TRUE WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND operation_id=${operationId} AND status IN ('superseded','cancelled') AND NOT unresolved_upload`;
  });
}
export async function releaseAppDataOperation(
  identity: AppDataIdentity,
  operationId: string,
) {
  return step(async () => {
    await rows`UPDATE appdata_operations SET status=CASE WHEN status='committed' THEN 'committed' WHEN unresolved_upload THEN 'uncertain' ELSE 'reserved' END WHERE account_id=${identity.accountId} AND generation=${identity.generation}::uuid AND operation_id=${operationId} AND status IN ('uploading','uncertain','committed')`;
  });
}
