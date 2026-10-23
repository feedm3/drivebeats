import { type NextRequest, NextResponse } from "next/server";
import { initializeAppDataAccount } from "@/db/appdata-control";
import { AUTH_SESSION_COOKIE, serializeAuthSession } from "@/lib/auth-session";
import {
  exchangeCodeForTokens,
  getUserFromIdToken,
  hasGoogleDriveScope,
  parseGrantedGoogleScopes,
} from "@/lib/google";
import {
  GoogleGrantError,
  resolveGoogleRefreshToken,
} from "@/lib/google-grant-service";
import {
  clearGoogleOAuthCookies,
  OAUTH_CONSENT_RETRY_COOKIE,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_COOKIE,
  startGoogleOAuth,
} from "@/lib/google-oauth-flow";

const AUTH_ERROR_PARAM = "authError";

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
    | "missing_refresh_token"
    | "missing_drive_scope",
) {
  const url = new URL("/", request.url);
  url.searchParams.set(AUTH_ERROR_PARAM, code);
  const response = NextResponse.redirect(url);
  clearGoogleOAuthCookies(response);
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

  if (!hasGoogleDriveScope(data.scope)) {
    return redirectWithAuthError(request, "missing_drive_scope");
  }

  if (!data.id_token) {
    return redirectWithAuthError(request, "authentication_failed");
  }

  let user: Awaited<ReturnType<typeof getUserFromIdToken>>;
  try {
    user = await getUserFromIdToken(data.id_token, expectedNonce);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return redirectWithAuthError(request, "authentication_failed");
  }

  let refreshToken: string | null;
  try {
    refreshToken = await resolveGoogleRefreshToken(user, data.refresh_token);
  } catch (error) {
    // Do not log provider credentials or database connection details.
    console.error("OAuth grant storage or refresh failed", {
      stage: error instanceof GoogleGrantError ? error.stage : "unknown",
      reason:
        error instanceof GoogleGrantError ? error.reason : "operation_failed",
    });
    return redirectWithAuthError(request, "authentication_failed");
  }
  if (!refreshToken) {
    if (request.cookies.get(OAUTH_CONSENT_RETRY_COOKIE)?.value === state) {
      return redirectWithAuthError(request, "missing_refresh_token");
    }
    const recovery = startGoogleOAuth(user.id);
    clearAuthCookies(recovery);
    return recovery;
  }

  let accountGeneration: string;
  try {
    accountGeneration = (await initializeAppDataAccount(user.id)).generation;
  } catch {
    return redirectWithAuthError(request, "authentication_failed");
  }
  const response = NextResponse.redirect(new URL("/app", request.url));
  response.headers.set("Cache-Control", "no-store");

  clearGoogleOAuthCookies(response);
  clearAuthCookies(response);
  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  response.cookies.set(
    AUTH_SESSION_COOKIE,
    serializeAuthSession({
      user,
      accountGeneration,
      grantedScopes: parseGrantedGoogleScopes(data.scope),
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    },
  );

  return response;
}
