import { z } from "zod";

import { apiError, notFound } from "@/lib/api";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mode = z.enum(["approve", "prompt", "deny"]);
const name = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Invalid MCP server or tool name");
const schema = z.object({
  serverName: name,
  defaultMode: mode,
  tools: z
    .record(name, mode)
    .refine((tools) => Object.keys(tools).length <= 500, {
      message: "A server policy can contain at most 500 tool rules.",
    }),
  expectedVersion: z.number().int().nonnegative(),
});

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/agents/[id]/tool-policies">,
) {
  try {
    const { id } = await ctx.params;
    const agent = agentRepository.getAgent(id);
    if (!agent) throw notFound("Agent not found");
    return Response.json({
      data: agentToolPolicyRepository.listForAgent(agent.id),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/agents/[id]/tool-policies">,
) {
  try {
    const { id } = await ctx.params;
    const agent = agentRepository.getAgent(id);
    if (!agent) throw notFound("Agent not found");
    const input = schema.parse(await request.json());
    const saved = agentToolPolicyRepository.save({
        agentId: agent.id,
        ...input,
      });
    return Response.json({
      data: saved,
    });
  } catch (error) {
    return apiError(error);
  }
}
