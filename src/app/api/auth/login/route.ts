import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE } from "@/lib/auth-session";
import { getGoogleAuthUrl, refreshAccessToken } from "@/lib/google";

const OAUTH_STATE_COOKIE = "oauth_state";

export async function GET(request: NextRequest) {
  const refreshToken = request.cookies.get("refresh_token")?.value ?? null;
  const userSession = request.cookies.get(AUTH_SESSION_COOKIE)?.value ?? null;

  if (refreshToken && userSession) {
    const data = await refreshAccessToken(refreshToken);
    if (!data.error) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(
    getGoogleAuthUrl({ state, prompt: "consent" }),
  );

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 10 * 60,
  });

  return response;
}
