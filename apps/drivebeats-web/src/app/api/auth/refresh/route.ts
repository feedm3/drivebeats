import { type NextRequest, NextResponse } from "next/server";
import { assertAppDataIdentity } from "@/db/appdata-control";
import { AppDataError } from "@/db/appdata-types";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import { hasRequiredGoogleScopes, refreshAccessToken } from "@/lib/google";

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

export async function POST(request: NextRequest) {
  const refresh_token = request.cookies.get("refresh_token")?.value;
  const authSession = parseAuthSession(
    request.cookies.get(AUTH_SESSION_COOKIE)?.value,
  );

  if (!authSession) {
    const response = NextResponse.json(
      { error: "Drive access was not granted for this session" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
    clearAuthCookies(response);
    return response;
  }

  if (
    !hasRequiredGoogleScopes(authSession.grantedScopes) ||
    !authSession.accountGeneration
  ) {
    return NextResponse.json(
      {
        error: "Google Drive backup access is required",
        code: "appdata_consent_required",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const account = await assertAppDataIdentity({
      accountId: authSession.user.id,
      generation: authSession.accountGeneration,
    });
    if (account.source !== "drive") {
      return NextResponse.json(
        {
          error: "Google Drive backup is being prepared",
          code: "appdata_not_ready",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    if (
      error instanceof AppDataError &&
      error.code === "appdata_deletion_in_progress"
    ) {
      return NextResponse.json(
        {
          error:
            "Backup cleanup is incomplete. Open Storage & data for recovery or support.",
          code: error.code,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const stale =
      error instanceof AppDataError && error.code === "appdata_stale_session";
    return NextResponse.json(
      {
        error: stale
          ? "Reconnect your account"
          : "Your account connection is temporarily unavailable. Retry shortly.",
        code: stale ? "account_unavailable" : "appdata_control_unavailable",
      },
      { status: stale ? 401 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!refresh_token) {
    return NextResponse.json(
      { error: "No refresh token provided" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  let data: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    data = await refreshAccessToken(refresh_token);
  } catch {
    return NextResponse.json(
      { error: "Google access is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (data.error && data.error !== "invalid_grant") {
    return NextResponse.json(
      { error: "Google access is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (data.error) {
    const response = NextResponse.json(
      { error: data.error_description },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
    clearAuthCookies(response);
    return response;
  }

  if (data.scope && !hasRequiredGoogleScopes(data.scope)) {
    return NextResponse.json(
      {
        error: "Google Drive backup access is required",
        code: "appdata_consent_required",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number"
  ) {
    return NextResponse.json(
      { error: "Google did not return a usable access token" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
      user: authSession.user,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
