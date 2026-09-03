import { agentRepository } from "@/lib/repositories/agent-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
import { ALL_INTEGRATION_TOOLS } from "@/lib/integrations/tool-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().positive(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; integrationId: string }> },
) {
  try {
    const [{ id: agentId, integrationId }, input] = await Promise.all([
      params,
      request.json().then((body) => schema.parse(body)),
    ]);
    const agent = agentRepository.getAgent(agentId);
    const integration = integrationRepository.getIntegration(integrationId);
    if (!agent || !integration) {
      throw notFound("Agent or integration not found.");
    }

    const data = integrationRepository.setAgentIntegrationTools(
      integrationId,
      agentId,
      input.enabled &&
        (integration.provider === "custom_http" ||
          integration.provider === "custom_mcp")
        ? [ALL_INTEGRATION_TOOLS]
        : input.enabled
          ? integration.tools.map((tool) => tool.key)
          : [],
      input.expectedVersion,
    );
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
