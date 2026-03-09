import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, serializeAuthUser } from "@/lib/auth-session";
import { exchangeCodeForTokens, getUserFromIdToken } from "@/lib/google";

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_NONCE_COOKIE = "oauth_nonce";
const AUTH_ERROR_PARAM = "authError";

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

function clearAuthCookies(response: NextResponse) {
  response.cookies.set("refresh_token", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function redirectWithAuthError(
  request: NextRequest,
  code:
    | "missing_oauth_state"
    | "invalid_oauth_state"
    | "oauth_denied"
    | "token_exchange_failed"
    | "authentication_failed"
    | "missing_refresh_token",
) {
  const url = new URL("/", request.url);
  url.searchParams.set(AUTH_ERROR_PARAM, code);
  const response = NextResponse.redirect(url);
  clearOAuthCookies(response);
  clearAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const expectedNonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;

  if (oauthError) {
    return redirectWithAuthError(request, "oauth_denied");
  }

  if (!code || !state || !expectedState || !expectedNonce) {
    return redirectWithAuthError(request, "missing_oauth_state");
  }

  if (state !== expectedState) {
    return redirectWithAuthError(request, "invalid_oauth_state");
  }

  let data: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    data = await exchangeCodeForTokens(code);
  } catch (error) {
    console.error("OAuth token exchange error:", error);
    return redirectWithAuthError(request, "token_exchange_failed");
  }

  if (data.error) {
    return redirectWithAuthError(request, "token_exchange_failed");
  }

  if (!data.id_token || !data.refresh_token) {
    return redirectWithAuthError(request, "missing_refresh_token");
  }

  let user: Awaited<ReturnType<typeof getUserFromIdToken>>;
  try {
    user = await getUserFromIdToken(data.id_token, expectedNonce);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return redirectWithAuthError(request, "authentication_failed");
  }

  const response = NextResponse.redirect(new URL("/app", request.url));

  clearOAuthCookies(response);
  clearAuthCookies(response);
  response.cookies.set("refresh_token", data.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  response.cookies.set(AUTH_SESSION_COOKIE, serializeAuthUser(user), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  return response;
}
