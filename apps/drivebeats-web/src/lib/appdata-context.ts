import { AppDataError } from "@/db/appdata-control";
import { getGoogleOAuthGrant } from "@/db/google-oauth-grants";
import type { AuthSession, AuthUser } from "@/lib/auth-session";
import { getDriveAppDataService } from "@/lib/drive-appdata-service";
import { hasRequiredGoogleScopes, refreshAccessToken } from "@/lib/google";
import { decryptGoogleRefreshToken } from "@/lib/google-grant-encryption";
import { getServerAuthSession } from "@/lib/server-auth";

/** Read credentials only after the signed incarnation has passed the server fence. */
export async function getAppDataContext(
  user: AuthUser,
  allowIncomplete = false,
) {
  const session = await getServerAuthSession({ allowIncomplete });
  return contextForSession(user, session);
}

/** Reuse a session already checked by this route; service reads still fence
 * their identity before and after provider access. Never cache across requests. */
export async function getAppDataContextForSession(session: AuthSession) {
  return contextForSession(session.user, session);
}

async function contextForSession(user: AuthUser, session: AuthSession | null) {
  if (
    !session?.accountGeneration ||
    session.user.id !== user.id ||
    !hasRequiredGoogleScopes(session.grantedScopes)
  ) {
    throw new AppDataError("appdata_access_required");
  }
  const encrypted = await getGoogleOAuthGrant(user.id);
  if (!encrypted) throw new AppDataError("appdata_access_required");
  const token = await refreshAccessToken(
    decryptGoogleRefreshToken(encrypted, user.id),
  );
  if (
    token.error === "invalid_grant" ||
    (token.scope && !hasRequiredGoogleScopes(token.scope))
  ) {
    throw new AppDataError("appdata_access_required");
  }
  if (token.error || !token.access_token)
    throw new AppDataError("appdata_provider_unavailable");
  return {
    identity: { accountId: user.id, generation: session.accountGeneration },
    service: getDriveAppDataService(token.access_token),
  };
}
