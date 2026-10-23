import { cookies } from "next/headers";
import { assertAppDataIdentity, getAppDataAccount } from "@/db/appdata-control";
import { AppDataError } from "@/db/appdata-types";
import {
  AUTH_SESSION_COOKIE,
  type AuthSession,
  parseAuthSession,
} from "@/lib/auth-session";
import { hasRequiredGoogleScopes } from "@/lib/google";

export async function getServerAuthSession(
  options: { allowIncomplete?: boolean } = {},
): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const session = parseAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) return null;
  if (!session.accountGeneration)
    return options.allowIncomplete ? session : null;
  try {
    const account = options.allowIncomplete
      ? await getAppDataAccount(session.user.id)
      : await assertAppDataIdentity({
          accountId: session.user.id,
          generation: session.accountGeneration,
        });
    if (
      !account ||
      account.generation !== session.accountGeneration ||
      account.state === "deleted"
    )
      return null;
    if (
      !options.allowIncomplete &&
      (!hasRequiredGoogleScopes(session.grantedScopes) ||
        account.source !== "drive")
    )
      return null;
    return session;
  } catch (error) {
    if (error instanceof AppDataError && error.code === "appdata_stale_session")
      return null;
    // Rendering/recovery may keep the signed identity; every normal API still
    // requires a live control check and receives a retryable outage instead.
    if (options.allowIncomplete) return session;
    if (error instanceof AppDataError) throw error;
    throw new AppDataError("appdata_control_unavailable");
  }
}
