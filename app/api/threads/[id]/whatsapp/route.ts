import { apiError, notFound } from "@/lib/api";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
import { getRunRetryState } from "@/lib/run-retry";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!conversationRepository.getThread(id))
      throw notFound("Conversation not found.");
    const status = whatsappAutomationRepository.getChatStatusForThread(id);
    if (!status) return Response.json({ data: null });
    const run = status.chat.lastRunId
      ? runRepository.getRun(status.chat.lastRunId)
      : null;
    const retry = run
      ? getRunRetryState(run, runRepository.listRunEvents(run.id))
      : null;
    const failedRun = run && retry ? { runId: run.id, retry } : null;
    return Response.json({ data: { ...status, failedRun } });
  } catch (error) {
    return apiError(error);
  }
}
