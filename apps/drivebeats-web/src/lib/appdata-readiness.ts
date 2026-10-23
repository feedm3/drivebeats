import { hasRequiredGoogleScopes } from "@/lib/google-scopes";

export const APPDATA_READINESS_KEY_PREFIX = "drivebeats-appdata-ready-v1:";

interface VerifiedReadiness {
  version: 1;
  accountId: string;
  generation: string;
  migrationVersion: number;
}

function key(accountId: string) {
  return `${APPDATA_READINESS_KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

/** Local playback proof only; server authorization always validates the live account. */
export function hasVerifiedAppDataReadiness(
  accountId: string,
  generation: string | undefined,
  scopes: string[] | undefined,
) {
  if (!generation || !hasRequiredGoogleScopes(scopes)) return false;
  try {
    const saved = JSON.parse(
      localStorage.getItem(key(accountId)) ?? "null",
    ) as VerifiedReadiness | null;
    return (
      saved?.version === 1 &&
      saved.accountId === accountId &&
      saved.generation === generation &&
      Number.isInteger(saved.migrationVersion) &&
      saved.migrationVersion >= 1
    );
  } catch {
    return false;
  }
}

/** Call only after a successful authenticated bootstrap with verified Drive authority. */
export function saveVerifiedAppDataReadiness(
  accountId: string,
  generation: string,
  migrationVersion: number,
) {
  try {
    localStorage.setItem(
      key(accountId),
      JSON.stringify({
        version: 1,
        accountId,
        generation,
        migrationVersion,
      } satisfies VerifiedReadiness),
    );
  } catch {
    // Private browsing/storage limits disable offline readiness, never live access.
  }
}

export function clearVerifiedAppDataReadiness(accountId: string) {
  try {
    localStorage.removeItem(key(accountId));
  } catch {}
}
