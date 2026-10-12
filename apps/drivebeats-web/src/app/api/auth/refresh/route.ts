import { type NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, parseAuthSession } from "@/lib/auth-session";
import { hasGoogleDriveScope, refreshAccessToken } from "@/lib/google";

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

  if (!authSession || !hasGoogleDriveScope(authSession.grantedScopes)) {
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

  if (!refresh_token) {
    return NextResponse.json(
      { error: "No refresh token provided" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const data = await refreshAccessToken(refresh_token);
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

  if (data.scope && !hasGoogleDriveScope(data.scope)) {
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
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number"
  ) {
    const response = NextResponse.json(
      { error: "Google did not return a usable access token" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
    clearAuthCookies(response);
    return response;
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
