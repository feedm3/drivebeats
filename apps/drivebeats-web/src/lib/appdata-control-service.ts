import {
  appDataAccount,
  assertAppDataIdentity,
  fenceAppDataAccount,
} from "@/db/appdata-accounts";
import {
  appDataOperation,
  findAppDataOperation,
  listAccountPendingAppDataOperations,
  listAppDataOperations,
  listPendingAppDataOperations,
  listPrunableAppDataOperations,
  markAppDataOperationPruned,
  releaseAppDataOperation,
} from "@/db/appdata-operations";
import { appDataRows as rows, appDataStep as step } from "@/db/appdata-query";
import { getAppDataRollout } from "@/db/appdata-rollout";
import { type AppDataControl, AppDataError } from "@/db/appdata-types";
/** Multi-table coordination is atomic inside PostgreSQL functions. */
export const appDataControl: AppDataControl = {
  assertIdentity: assertAppDataIdentity,
  getRollout: getAppDataRollout,
  list: listAppDataOperations,
  find: findAppDataOperation,
  listPending: listPendingAppDataOperations,
  listAccountPending: listAccountPendingAppDataOperations,
  listPrunable: listPrunableAppDataOperations,
  markPruned: markAppDataOperationPruned,
  release: releaseAppDataOperation,
  fence: fenceAppDataAccount,
  reserve: (identity, input) =>
    step(async () => {
      const result =
        await rows`SELECT * FROM reserve_appdata_operation(${identity.accountId},${identity.generation}::uuid,${input.operationId},${input.kind},${input.bodyHash},${input.fileId},${input.bytes},${input.baseRevision ?? null},${input.migrationIsEmpty},${input.commandHash ?? null},${input.commandResult ? JSON.stringify(input.commandResult) : null}::jsonb,${input.coveredSources ?? []})`;
      return appDataOperation(result[0]);
    }),
  startUpload: (identity, operationId, recover = false) =>
    step(async () => {
      const result =
        await rows`SELECT begin_appdata_upload(${identity.accountId},${identity.generation}::uuid,${operationId},${recover}) AS started`;
      return result[0].started ? String(result[0].started) : null;
    }),
  finishUpload: (identity, operationId, attemptId, unknown) =>
    step(async () => {
      await rows`SELECT settle_appdata_upload(${identity.accountId},${identity.generation}::uuid,${operationId},${attemptId}::uuid,${unknown})`;
    }),
  complete: (identity, operationId, uploadSettled = false) =>
    step(async () => {
      await rows`SELECT complete_appdata_operation(${identity.accountId},${identity.generation}::uuid,${operationId},${uploadSettled})`;
      const result = await findAppDataOperation(identity, operationId);
      if (!result) throw new AppDataError("appdata_operation_missing");
      return result;
    }),
  finishDeletion: (identity) =>
    step(async () => {
      await rows`SELECT finish_appdata_deletion(${identity.accountId},${identity.generation}::uuid)`;
    }),
  resetAccount: (identity) =>
    step(async () => {
      const result =
        await rows`SELECT * FROM reset_appdata_account(${identity.accountId},${identity.generation}::uuid)`;
      return appDataAccount(result[0]);
    }),
  prepareReset: (identity) =>
    step(async () => {
      await rows`SELECT prepare_appdata_reset(${identity.accountId},${identity.generation}::uuid)`;
    }),
};
