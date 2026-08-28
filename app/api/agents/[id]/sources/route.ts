import { z } from "zod";
import { apiError, conflict, notFound } from "@/lib/api";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { sourceRepository } from "@/lib/repositories/source-repository";
import { getKnowledgeSource } from "@/lib/sources/service";

export const runtime = "nodejs";

const schema = z
  .object({
    sourceId: z.string().uuid(),
    enabled: z.boolean(),
    expectedAccessVersion: z.number().int().positive(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/agents/[id]/sources">,
) {
  try {
    const { id } = await context.params;
    const agent = agentRepository.getAgent(id);
    if (!agent) throw notFound("Agent not found.");
    const input = schema.parse(await request.json());
    if (!sourceRepository.getSource(input.sourceId))
      throw notFound("Source not found.");
    const source = sourceRepository.setAgentAccess({
      sourceId: input.sourceId,
      agentId: agent.id,
      enabled: input.enabled,
      expectedAccessVersion: input.expectedAccessVersion,
    });
    if (!source) {
      throw conflict(
        "Source access changed while you were editing it.",
        "SOURCE_ACCESS_VERSION_CONFLICT",
      );
    }
    return Response.json({ data: getKnowledgeSource(source.id) });
  } catch (error) {
    return apiError(error, "Could not update source access.");
  }
}
