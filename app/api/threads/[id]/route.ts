import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { apiError, notFound } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/threads/[id]">,
) {
  const { id } = await ctx.params;
  const thread = conversationRepository.getThread(id);
  if (!thread) return apiError(notFound("Thread not found"));
  const agent = agentRepository.getAgent(thread.agentId);
  return Response.json({
    data: { thread, agent, messages: conversationRepository.listMessages(id) },
  });
}
