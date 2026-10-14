import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import { hasGoogleDriveScope, refreshAccessToken } from "@/lib/google";
import { startGoogleOAuth } from "@/lib/google-oauth-flow";

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

  return startGoogleOAuth();
}
