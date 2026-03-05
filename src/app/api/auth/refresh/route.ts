import { type NextRequest, NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/google";

export async function POST(request: NextRequest) {
  const { refresh_token } = await request.json();
  if (!refresh_token) {
    return NextResponse.json(
      { error: "No refresh token provided" },
      { status: 400 },
    );
  }

  const data = await refreshAccessToken(refresh_token);
  if (data.error) {
    return NextResponse.json(
      { error: data.error_description },
      { status: 400 },
    );
  }

  return NextResponse.json({
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}
