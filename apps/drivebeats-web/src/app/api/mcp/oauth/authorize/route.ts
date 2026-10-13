import {
  approveMcpAuthorization,
  startMcpAuthorization,
} from "@/lib/mcp/oauth-service";
export const runtime = "nodejs";
export const GET = startMcpAuthorization;
export const POST = approveMcpAuthorization;
