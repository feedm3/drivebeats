import { redirect } from "next/navigation";
import { getGoogleAuthUrl, refreshAccessToken } from "@/lib/google";

export async function GET(request: Request) {
  const refreshToken =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("refresh_token="))
      ?.slice("refresh_token=".length) ?? null;

  if (refreshToken) {
    const data = await refreshAccessToken(refreshToken);
    if (!data.error) {
      redirect("/app");
    }
  }

  redirect(getGoogleAuthUrl());
}
