import { handlePostHogMcpRequest } from "@/lib/integrations/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agentId = new URL(request.url).searchParams.get("agent") ?? "";
  return handlePostHogMcpRequest(request, id, agentId);
}

export function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
