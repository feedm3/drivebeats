import { hasGoogleDriveScope } from "@/lib/google";
import { refreshGoogleOAuthAccessToken } from "@/lib/google-api";

type DriveReadTokenResult =
  | { status: 200; accessToken: string }
  | { status: 401 }
  | { status: 502 };

function getRequiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function refreshDriveReadToken(
  refreshToken: string,
  signal: AbortSignal,
): Promise<DriveReadTokenResult> {
  try {
    signal.throwIfAborted();
    const response = await refreshGoogleOAuthAccessToken(
      {
        clientId: getRequiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
      },
      refreshToken,
    );
    signal.throwIfAborted();
    const data: unknown = await response.json();
    signal.throwIfAborted();
    if (!data || typeof data !== "object" || Array.isArray(data))
      return { status: 502 };
    const token = data as Record<string, unknown>;
    // Provider failures must not log out an account or clear its device data.
    if (response.status === 400 && token.error === "invalid_grant")
      return { status: 401 };
    if (
      !response.ok ||
      token.error !== undefined ||
      typeof token.access_token !== "string" ||
      !/^[^\s]{1,2048}$/.test(token.access_token) ||
      typeof token.expires_in !== "number" ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0 ||
      (token.scope !== undefined && typeof token.scope !== "string")
    )
      return { status: 502 };
    if (typeof token.scope === "string" && !hasGoogleDriveScope(token.scope))
      return { status: 401 };
    return { status: 200, accessToken: token.access_token };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 502 };
  }
}
