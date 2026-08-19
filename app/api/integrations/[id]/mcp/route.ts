import {
  handlePostHogMcpRequest,
  routeCustomMcpRequest,
} from "@/lib/integrations/mcp-server";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agentId = new URL(request.url).searchParams.get("agent") ?? "";
  const integration = repository.getIntegrationRecord(id);
  if (!integration) {
    return new Response("Integration not found", { status: 404 });
  }

  if (integration.provider !== "posthog") {
    return routeCustomMcpRequest(request, id, agentId);
  }
  return handlePostHogMcpRequest(request, id, agentId);
}

export function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
