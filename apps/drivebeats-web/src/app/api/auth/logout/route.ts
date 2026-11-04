import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE } from "@/lib/auth-session";
import {
  GOOGLE_SESSION_GRANT_COOKIE,
  GOOGLE_SESSION_GRANT_COOKIE_OPTIONS,
} from "@/lib/google-grant-encryption";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(GOOGLE_SESSION_GRANT_COOKIE, "", {
    ...GOOGLE_SESSION_GRANT_COOKIE_OPTIONS,
    maxAge: 0,
  });

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

  return response;
}
