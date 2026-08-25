import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
const schema = z.object({
  agentId: z.string().uuid(),
  title: z.string().min(1).max(100).default("General"),
});
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (!agentRepository.getAgent(input.agentId))
      throw notFound("Agent not found");
    return Response.json(
      { data: conversationRepository.createThread(input.agentId, input.title) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
