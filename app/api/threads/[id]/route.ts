import { repository } from "@/lib/repository";
import { apiError, notFound } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/threads/[id]">,
) {
  const { id } = await ctx.params;
  const thread = repository.getThread(id);
  if (!thread) return apiError(notFound("Thread not found"));
  const agent = repository.getAgent(thread.agentId);
  return Response.json({
    data: { thread, agent, messages: repository.listMessages(id) },
  });
}
