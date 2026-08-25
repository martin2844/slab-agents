import { apiError, conflict, notFound } from "@/lib/api";
import {
  retestCustomHttpIntegration,
  retestCustomMcpIntegration,
  retestPostHogIntegration,
} from "@/lib/integrations/service";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const integration = repository.getIntegrationRecord(id);
    if (!integration) {
      throw notFound("Integration not found.");
    }

    if (integration.provider === "posthog") {
      return Response.json({ data: await retestPostHogIntegration(id) });
    }
    if (integration.provider === "custom_http") {
      return Response.json({ data: await retestCustomHttpIntegration(id) });
    }
    if (integration.provider === "custom_mcp") {
      return Response.json({ data: await retestCustomMcpIntegration(id) });
    }
    throw conflict("Integration type does not support testing.");
  } catch (error) {
    return apiError(error);
  }
}
