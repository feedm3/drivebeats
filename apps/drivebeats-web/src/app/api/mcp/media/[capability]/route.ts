import { handleMcpMediaRequest } from "@/lib/mcp/media-service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ capability: string }> },
) {
  const { capability } = await context.params;
  return handleMcpMediaRequest(request, capability);
}
