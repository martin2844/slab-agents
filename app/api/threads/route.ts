import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
import { repository } from "@/lib/repository";
const schema = z.object({
  agentId: z.string().uuid(),
  title: z.string().min(1).max(100).default("General"),
});
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (!repository.getAgent(input.agentId)) throw notFound("Agent not found");
    return Response.json(
      { data: repository.createThread(input.agentId, input.title) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
