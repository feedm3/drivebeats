// Stable imports; implementations live beside their table or in lib workflows.
export {
  assertAppDataIdentity,
  claimAppDataMigration,
  getAppDataAccount,
  initializeAppDataAccount,
} from "@/db/appdata-accounts";
export {
  getAppDataRollout,
  isAppDataLegacySourceAvailable,
} from "@/db/appdata-rollout";
export * from "@/db/appdata-types";
