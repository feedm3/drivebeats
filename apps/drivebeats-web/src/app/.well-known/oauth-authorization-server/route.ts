import { getMcpAuthConfig } from "@/lib/mcp/auth";
export function GET() {
  const { issuer, scopes } = getMcpAuthConfig();
  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/api/mcp/oauth/authorize`,
      token_endpoint: `${issuer}/api/mcp/oauth/token`,
      revocation_endpoint: `${issuer}/api/mcp/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: scopes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
