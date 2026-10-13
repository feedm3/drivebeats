import { handleMcpRequest } from "@/lib/mcp/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleMcpRequest(request);
}
