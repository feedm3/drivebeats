import { NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/google";

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_NONCE_COOKIE = "oauth_nonce";
export const OAUTH_CONSENT_RETRY_COOKIE = "oauth_consent_retry";
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api/auth",
} as const;

export function startGoogleOAuth(consentAccountId?: string) {
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const response = NextResponse.redirect(
    getGoogleAuthUrl({
      state,
      nonce,
      prompt: consentAccountId ? "consent" : undefined,
      loginHint: consentAccountId,
    }),
  );
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...cookieOptions,
    maxAge: 600,
  });
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    ...cookieOptions,
    maxAge: 600,
  });
  // Bind the retry guard to this attempt, so recovery cannot loop forever.
  response.cookies.set(
    OAUTH_CONSENT_RETRY_COOKIE,
    consentAccountId ? state : "",
    {
      ...cookieOptions,
      maxAge: consentAccountId ? 600 : 0,
    },
  );
  return response;
}

export function clearGoogleOAuthCookies(response: NextResponse) {
  for (const name of [
    OAUTH_STATE_COOKIE,
    OAUTH_NONCE_COOKIE,
    OAUTH_CONSENT_RETRY_COOKIE,
  ]) {
    response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
  }
}
