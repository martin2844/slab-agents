import { agentRepository } from "@/lib/repositories/agent-repository";
import { z } from "zod";
import { apiError, notFound } from "@/lib/api";

export const runtime = "nodejs";

const schema = z.object({
  label: z.string().trim().min(2).max(48).optional(),
  prompt: z.string().trim().min(10).max(20_000).optional(),
});

async function ownedAction(agentId: string, actionId: string) {
  const agent = agentRepository.getAgent(agentId);
  const action = agentRepository.getAgentQuickAction(actionId);
  if (!agent || !action || action.agentId !== agent.id) {
    throw notFound("Quick task not found");
  }
  return action;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; actionId: string }> },
) {
  try {
    const { id, actionId } = await ctx.params;
    await ownedAction(id, actionId);
    return Response.json({
      data: agentRepository.updateAgentQuickAction(
        actionId,
        schema.parse(await request.json()),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; actionId: string }> },
) {
  try {
    const { id, actionId } = await ctx.params;
    await ownedAction(id, actionId);
    agentRepository.deleteAgentQuickAction(actionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
