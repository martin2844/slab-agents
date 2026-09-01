import { integrationRepository } from "@/lib/repositories/integration-repository";
import {
  handlePostHogMcpRequest,
  routeCustomMcpRequest,
} from "@/lib/integrations/mcp-server";
import { isCalendarProvider } from "@/lib/integrations/calendar-contract";
import { handleCalendarMcpRequest } from "@/lib/integrations/calendar-mcp";
import { isGoogleDataProvider } from "@/lib/integrations/google-data-contract";
import { handleGoogleDataMcpRequest } from "@/lib/integrations/google-data-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestUrl = new URL(request.url);
  const integration = integrationRepository.getIntegrationRecord(id);
  if (!integration) {
    return new Response("Integration not found", { status: 404 });
  }

  if (integration.provider !== "posthog") {
    const runId = requestUrl.searchParams.get("run") ?? "";
    if (isGoogleDataProvider(integration.provider)) {
      return handleGoogleDataMcpRequest(request, id, runId);
    }
    if (isCalendarProvider(integration.provider)) {
      return handleCalendarMcpRequest(request, id, runId);
    }
    return routeCustomMcpRequest(request, id, runId);
  }
  const agentId = requestUrl.searchParams.get("agent") ?? "";
  return handlePostHogMcpRequest(request, id, agentId);
}

export function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
