import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
import { repository } from "@/lib/repository";

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
    const agent = repository.getAgent(agentId);
    const integration = repository.getIntegration(integrationId);
    if (!agent || !integration) {
      throw notFound("Agent or integration not found.");
    }

    const data = repository.setAgentIntegrationTools(
      integrationId,
      agentId,
      input.enabled ? integration.tools.map((tool) => tool.key) : [],
      input.expectedVersion,
    );
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
