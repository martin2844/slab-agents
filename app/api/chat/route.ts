import { z } from "zod";
import { repository } from "@/lib/repository";
import { createRunExecution, executeRun } from "@/lib/run-service";
import { apiError, conflict, notFound } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  threadId: z.string().uuid(),
  message: z.string().min(1).max(50_000),
});
export async function POST(request: Request) {
  try {
    const { threadId, message } = schema.parse(await request.json());
    const thread = repository.getThread(threadId);
    if (!thread) throw notFound("Thread not found");
    const agent = repository.getAgent(thread.agentId);
    if (!agent) throw notFound("Agent not found");
    if (!agent.enabled)
      throw conflict("This agent is disabled.", "AGENT_DISABLED");
    const run = createRunExecution({
      agentId: agent.id,
      threadId,
      trigger: "chat",
      mode: "chat",
      prompt: message,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of executeRun({ runId: run.id })) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
