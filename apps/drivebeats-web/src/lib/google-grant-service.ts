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

// Call only after verifying Google's ID token (including its nonce).
export async function resolveGoogleRefreshToken(
  user: AuthUser,
  newRefreshToken: string | undefined,
) {
  if (newRefreshToken) {
    await upsertUser(user);
    await saveGoogleOAuthGrant(
      user.id,
      encryptGoogleRefreshToken(newRefreshToken, user.id),
    );
    return newRefreshToken;
  }

  const encrypted = await getGoogleOAuthGrant(user.id);
  if (!encrypted) return null;
  let token: string;
  try {
    token = decryptGoogleRefreshToken(encrypted, user.id);
  } catch {
    // A rotated session secret or an unreadable grant needs fresh approval.
    return null;
  }

  const refreshed = await refreshAccessToken(token);
  if (refreshed.error === "invalid_grant") {
    await deleteGoogleOAuthGrant(user.id);
    return null;
  }
  if (refreshed.error) throw new Error("Google grant refresh failed");
  if (refreshed.scope && !hasGoogleDriveScope(refreshed.scope)) return null;
  if (!refreshed.access_token || typeof refreshed.expires_in !== "number") {
    throw new Error("Google grant refresh returned an unusable token");
  }
  return token;
}
