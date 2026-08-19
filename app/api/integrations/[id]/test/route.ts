import { apiError } from "@/lib/api";
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
      return Response.json({ error: "Integration not found." }, { status: 404 });
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
    throw new Error("Integration type mismatch.");
  } catch (error) {
    return apiError(error);
  }
}
