import { z } from "zod";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";

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
  const agent = repository.getAgent(id);
  if (!agent)
    return Response.json({ error: "Agent not found" }, { status: 404 });
  return Response.json({ data: repository.listAgentQuickActions(agent.id) });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const agent = repository.getAgent(id);
    if (!agent) throw new Error("Agent not found");
    const input = schema.parse(await request.json());
    return Response.json(
      { data: repository.createAgentQuickAction(agent.id, input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
