import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { SITE_URL } from "../site";
import {
  authenticateMcpRequest,
  getMcpAuthChallenge,
  getMcpAuthConfig,
  McpAuthError,
} from "./auth";
import { drivebeatsMcpHandler } from "./server";

export async function handleMcpRequest(
  request: Request,
  handler: Pick<typeof drivebeatsMcpHandler, "fetch"> = drivebeatsMcpHandler,
) {
  let issuerHostnames: string[] = [];
  try {
    issuerHostnames = [new URL(getMcpAuthConfig().issuer).hostname];
  } catch {
    // Unconfigured/invalid auth must not widen the transport allowlist.
  }
  const allowedHostnames = [
    ...localhostAllowedHostnames(),
    new URL(SITE_URL).hostname,
    "drivebeats.app",
    ...issuerHostnames,
    ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].flatMap((url) =>
      url ? [new URL(`https://${url}`).hostname] : [],
    ),
  ];
  const rejection =
    hostHeaderValidationResponse(request, allowedHostnames) ??
    originValidationResponse(request, allowedHostnames);
  if (rejection) return rejection;
  if (request.headers.has("authorization")) {
    try {
      await authenticateMcpRequest(request, []);
    } catch (error) {
      const headers = new Headers({ "Cache-Control": "no-store" });
      try {
        headers.set(
          "WWW-Authenticate",
          `${getMcpAuthChallenge()}, error="invalid_token", error_description="A valid DriveBeats access token is required."`,
        );
      } catch {}
      return Response.json(
        {
          error:
            error instanceof McpAuthError
              ? error.code
              : "temporarily_unavailable",
        },
        {
          status: error instanceof McpAuthError ? error.status : 503,
          headers,
        },
      );
    }
  }
  const response = await handler.fetch(request);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
