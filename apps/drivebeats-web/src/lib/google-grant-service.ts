import {
  deleteGoogleOAuthGrant,
  getGoogleOAuthGrant,
  saveGoogleOAuthGrant,
} from "@/db/google-oauth-grants";
import { upsertUser } from "@/db/users";
import type { AuthUser } from "@/lib/auth-session";
import { hasGoogleDriveScope, refreshAccessToken } from "@/lib/google";
import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "@/lib/google-grant-encryption";

type GrantStage =
  | "user_save"
  | "grant_encrypt"
  | "grant_save"
  | "grant_lookup"
  | "grant_refresh"
  | "grant_delete";

// Only fixed categories cross the logging boundary: provider and database
// exceptions can include credentials, connection strings, or account details.
export class GoogleGrantError extends Error {
  constructor(
    readonly stage: GrantStage,
    readonly reason: string,
  ) {
    super("Google grant operation failed");
  }
}

async function grantStep<T>(
  stage: GrantStage,
  operation: () => T,
): Promise<Awaited<T>> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GoogleGrantError) throw error;
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    const reason =
      code === "42P01" || code === "42703"
        ? "database_schema"
        : code === "42501"
          ? "database_permission"
          : code === "23503" || code === "23514" || code === "23505"
            ? "database_constraint"
            : "operation_failed";
    throw new GoogleGrantError(stage, reason);
  }
}

// Call only after verifying Google's ID token (including its nonce).
export async function resolveGoogleRefreshToken(
  user: AuthUser,
  newRefreshToken: string | undefined,
) {
  if (newRefreshToken) {
    await grantStep("user_save", () => upsertUser(user));
    const encrypted = await grantStep("grant_encrypt", () =>
      encryptGoogleRefreshToken(newRefreshToken, user.id),
    );
    await grantStep("grant_save", () =>
      saveGoogleOAuthGrant(user.id, encrypted),
    );
    return newRefreshToken;
  }

  const encrypted = await grantStep("grant_lookup", () =>
    getGoogleOAuthGrant(user.id),
  );
  if (!encrypted) return null;
  let token: string;
  try {
    token = decryptGoogleRefreshToken(encrypted, user.id);
  } catch {
    // A rotated session secret or an unreadable grant needs fresh approval.
    return null;
  }

  const refreshed = await grantStep("grant_refresh", () =>
    refreshAccessToken(token),
  );
  if (refreshed.error === "invalid_grant") {
    await grantStep("grant_delete", () => deleteGoogleOAuthGrant(user.id));
    return null;
  }
  if (refreshed.error === "unauthorized_client") {
    // A saved token can belong to a different OAuth client (for example, when
    // development and production share a database). Request a replacement via
    // the callback's one-attempt consent recovery; the old token is not revoked.
    return null;
  }
  if (refreshed.error) {
    const reason = [
      "invalid_client",
      "invalid_request",
      "temporarily_unavailable",
      "server_error",
    ].includes(refreshed.error)
      ? refreshed.error
      : "provider_error";
    throw new GoogleGrantError("grant_refresh", reason);
  }
  if (refreshed.scope && !hasGoogleDriveScope(refreshed.scope)) return null;
  if (!refreshed.access_token || typeof refreshed.expires_in !== "number") {
    throw new GoogleGrantError("grant_refresh", "unusable_token");
  }
  return token;
}
