import { completeMcpImportSelection } from "@/lib/mcp/import-selection-service";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ capability: string }> },
) {
  const { capability } = await params;
  const auth = await getServerAuthSession();
  return completeMcpImportSelection(request, capability, auth?.user ?? null);
}
