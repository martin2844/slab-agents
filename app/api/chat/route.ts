import { z } from "zod";
import { repository } from "@/lib/repository";
import { executeRun } from "@/lib/run-service";
import { apiError } from "@/lib/api";

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
    if (!thread) throw new Error("Thread not found");
    const agent = repository.getAgent(thread.agentId);
    if (!agent) throw new Error("Agent not found");
    if (!agent.enabled) throw new Error("This agent is disabled.");
    const run = repository.createRun({
      agentId: agent.id,
      threadId,
      runtime: agent.runtime,
    });
    repository.addMessage(threadId, run.id, "user", message);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of executeRun({
            runId: run.id,
            prompt: message,
          })) {
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
