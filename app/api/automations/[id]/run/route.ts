import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";
import { executeAutomationRun } from "@/lib/run-service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/automations/[id]/run">,
) {
  try {
    const { id } = await ctx.params;
    const automation = repository.getAutomation(id);
    if (!automation) throw new Error("Automation not found");
    const agent = repository.getAgent(automation.agentId);
    if (!agent) throw new Error("Agent not found");
    if (!agent.enabled) throw new Error("This agent is disabled.");

    const thread = repository.createThread(agent.id, automation.name);
    const run = repository.createRun({
      agentId: agent.id,
      threadId: thread.id,
      automationId: automation.id,
      runtime: agent.runtime,
    });
    repository.addMessage(thread.id, run.id, "user", automation.prompt);
    repository.updateAutomation(automation.id, {
      lastRunAt: new Date().toISOString(),
    });
    void executeAutomationRun(run.id, automation.prompt);
    return Response.json({ data: run }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
