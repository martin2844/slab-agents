import { repository } from "@/lib/repository";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/threads/[id]">,
) {
  const { id } = await ctx.params;
  const thread = repository.getThread(id);
  if (!thread)
    return Response.json({ error: "Thread not found" }, { status: 404 });
  const agent = repository.getAgent(thread.agentId);
  return Response.json({
    data: { thread, agent, messages: repository.listMessages(id) },
  });
}
