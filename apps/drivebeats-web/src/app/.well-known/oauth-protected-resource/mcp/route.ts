import { getMcpAuthConfig } from "@/lib/mcp/auth";
export function GET() {
  const { issuer, resource, scopes } = getMcpAuthConfig();
  return Response.json(
    {
      resource,
      authorization_servers: [issuer],
      scopes_supported: scopes,
      bearer_methods_supported: ["header"],
      resource_name: "DriveBeats",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
