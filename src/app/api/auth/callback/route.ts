import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_SESSION_COOKIE,
  serializeAuthUser,
} from "@/lib/auth-session";
import { exchangeCodeForTokens, getUserFromIdToken } from "@/lib/google";

const OAUTH_STATE_COOKIE = "oauth_state";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  const data = await exchangeCodeForTokens(code);
  if (data.error) {
    return NextResponse.json(
      { error: data.error_description },
      { status: 400 },
    );
  }

  if (!data.id_token) {
    return NextResponse.json({ error: "Missing id_token" }, { status: 400 });
  }

  const user = getUserFromIdToken(data.id_token);

  const response = NextResponse.redirect(new URL("/app", request.url));

  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });

  if (data.refresh_token) {
    response.cookies.set("refresh_token", data.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
  }

  response.cookies.set(AUTH_SESSION_COOKIE, serializeAuthUser(user), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  return response;
}
