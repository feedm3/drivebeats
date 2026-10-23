import { appDataRows as rows, appDataStep as step } from "@/db/appdata-query";
export async function getAppDataRollout() {
  return step(async () => {
    const result =
      await rows`SELECT implemented_at,cleanup_due_at,legacy_retired FROM appdata_rollout WHERE singleton=TRUE`;
    if (!result[0]) return null;
    return {
      implementedAt: new Date(String(result[0].implemented_at)).toISOString(),
      cleanupDueAt: new Date(String(result[0].cleanup_due_at)).toISOString(),
      legacyRetired: Boolean(result[0].legacy_retired),
    };
  });
}
export async function isAppDataLegacySourceAvailable() {
  return step(async () => {
    const result =
      await rows`SELECT NOT EXISTS(SELECT 1 FROM appdata_rollout WHERE singleton AND (cleanup_due_at<=now() OR legacy_retired)) AS available`;
    return Boolean(result[0].available);
  });
}
