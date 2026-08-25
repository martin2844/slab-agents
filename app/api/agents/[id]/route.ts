import { runRepository } from "@/lib/repositories/run-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
import { assertRuntimeSelectable } from "@/lib/runtime-config";

export const runtime = "nodejs";
const schema = z.object({
  name: z.string().min(2).optional(),
  role: z.string().min(2).optional(),
  instructions: z.string().min(10).optional(),
  runtime: z.string().min(1).max(64).optional(),
  model: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  fullAccess: z.boolean().optional(),
});
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/agents/[id]">,
) {
  const { id } = await ctx.params;
  const agent = agentRepository.getAgent(id);
  if (!agent) return apiError(notFound("Agent not found"));
  return Response.json({
    data: {
      agent,
      quickActions: agentRepository.listAgentQuickActions(agent.id),
      threads: conversationRepository.listThreads(agent.id),
      automations: automationRepository
        .listAutomations()
        .filter((a) => a.agentId === agent.id),
      runs: runRepository
        .listRuns()
        .filter((r) => r.agentId === agent.id)
        .slice(0, 10),
    },
  });
}
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/agents/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const current = agentRepository.getAgent(id);
    if (!current) throw notFound("Agent not found");
    const input = schema.parse(await request.json());
    assertRuntimeSelectable(
      input.runtime ?? current.runtime,
      input.model ?? current.model,
    );
    const agent = agentRepository.updateAgent(id, input);
    if (!agent) throw notFound("Agent not found");
    return Response.json({ data: agent });
  } catch (error) {
    return apiError(error);
  }
}
