import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, serializeAuthUser } from "@/lib/auth-session";
import { exchangeCodeForTokens, getUserFromIdToken } from "@/lib/google";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_NONCE_COOKIE = "oauth_nonce";

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
  response.cookies.set(OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const expectedNonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;

  if (!code || !state || !expectedState || !expectedNonce) {
    const response = NextResponse.json(
      { error: "Missing OAuth state" },
      { status: 400 },
    );
    clearOAuthCookies(response);
    return response;
  }

  if (state !== expectedState) {
    const response = NextResponse.json(
      { error: "Invalid OAuth state" },
      { status: 400 },
    );
    clearOAuthCookies(response);
    return response;
  }

  const data = await exchangeCodeForTokens(code);
  if (data.error) {
    const response = NextResponse.json(
      { error: data.error_description },
      { status: 400 },
    );
    clearOAuthCookies(response);
    return response;
  }

  if (!data.id_token) {
    const response = NextResponse.json(
      { error: "Missing id_token" },
      { status: 400 },
    );
    clearOAuthCookies(response);
    return response;
  }

  let user: Awaited<ReturnType<typeof getUserFromIdToken>>;
  try {
    user = await getUserFromIdToken(data.id_token, expectedNonce);
  } catch (error) {
    console.error("OAuth callback error:", error);
    const response = NextResponse.json(
      { error: "Authentication failed" },
      { status: 400 },
    );
    clearOAuthCookies(response);
    return response;
  }

  const response = NextResponse.redirect(new URL("/app", request.url));

  clearOAuthCookies(response);

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
