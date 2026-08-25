import { agentRepository } from "@/lib/repositories/agent-repository";
import { z } from "zod";
import { apiError, notFound } from "@/lib/api";

export const runtime = "nodejs";

const schema = z.object({
  label: z.string().trim().min(2).max(48),
  prompt: z.string().trim().min(10).max(20_000),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const agent = agentRepository.getAgent(id);
  if (!agent) return apiError(notFound("Agent not found"));
  return Response.json({
    data: agentRepository.listAgentQuickActions(agent.id),
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const agent = agentRepository.getAgent(id);
    if (!agent) throw notFound("Agent not found");
    const input = schema.parse(await request.json());
    return Response.json(
      { data: agentRepository.createAgentQuickAction(agent.id, input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
