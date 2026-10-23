import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import { hasRequiredGoogleScopes, refreshAccessToken } from "@/lib/google";
import { startGoogleOAuth } from "@/lib/google-oauth-flow";

export async function GET(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value ?? null;
  const authSession = parseAuthSession(
    request.cookies.get(AUTH_SESSION_COOKIE)?.value,
  );

  if (
    refreshToken &&
    authSession &&
    hasRequiredGoogleScopes(authSession.grantedScopes) &&
    authSession.accountGeneration &&
    !request.nextUrl.searchParams.has("reconnect")
  ) {
    const data = await refreshAccessToken(refreshToken);
    if (!data.error && (!data.scope || hasRequiredGoogleScopes(data.scope))) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  return startGoogleOAuth(authSession?.user.id);
}
