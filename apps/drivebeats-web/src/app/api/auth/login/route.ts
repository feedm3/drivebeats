import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import {
  getGoogleAuthUrl,
  hasGoogleDriveScope,
  refreshAccessToken,
} from "@/lib/google";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_NONCE_COOKIE = "oauth_nonce";

export async function GET(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value ?? null;
  const authSession = parseAuthSession(
    request.cookies.get(AUTH_SESSION_COOKIE)?.value,
  );

  if (
    refreshToken &&
    authSession &&
    hasGoogleDriveScope(authSession.grantedScopes)
  ) {
    const data = await refreshAccessToken(refreshToken);
    if (!data.error) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const response = NextResponse.redirect(
    getGoogleAuthUrl({ state, nonce, prompt: "consent" }),
  );

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 10 * 60,
  });
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 10 * 60,
  });

  return response;
}
