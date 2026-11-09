import "server-only";
import { conflict, notFound } from "@/lib/api";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
import {
  createRunExecution,
  executeRunInBackground,
} from "@/lib/run-service";
import type { Run, RunEvent, RunRetryState } from "@/lib/types";
import { tickWhatsAppAutomations } from "@/lib/whatsapp-automation-service";

type RetriedPayload = {
  strategy?: "new_run" | "whatsapp_requeue";
  retryRunId?: string | null;
  messageSequences?: number[];
};

function retriedEvent(events: RunEvent[]) {
  const event = events.find((item) => item.type === "run_retried");
  return event ? (event.payload as RetriedPayload) : null;
}

function retryRunIdFor(payload: RetriedPayload) {
  return (
    payload.retryRunId ??
    whatsappAutomationRepository.runForMessages(payload.messageSequences ?? [])
  );
}

function blockReason(run: Run): string | null {
  if (run.trigger === "email")
    return "Email workflow steps retry through their workflow, not individually.";
  const agent = agentRepository.getAgent(run.agentId);
  if (!agent) return "The agent no longer exists.";
  if (!agent.enabled) return "This agent is disabled.";
  if (!run.threadId || !conversationRepository.getThread(run.threadId))
    return "The run's conversation no longer exists.";
  if (!conversationRepository.getRunInput(run.id))
    return "The run's original input is missing.";
  if (run.trigger === "whatsapp")
    return whatsappAutomationRepository.retryBlockReason(run.id);
  return null;
}

/** Retry state for a run, or null when retrying does not apply (not failed). */
export function getRunRetryState(
  run: Run,
  events: RunEvent[],
): RunRetryState | null {
  if (run.status !== "failed") return null;
  const retried = retriedEvent(events);
  if (retried) return { status: "retried", retryRunId: retryRunIdFor(retried) };
  const reason = blockReason(run);
  return reason ? { status: "unavailable", reason } : { status: "available" };
}

type RetryDependencies = {
  execute?: (runId: string) => Promise<void>;
  tickWhatsApp?: () => Promise<unknown>;
};

/**
 * Retry a failed run once. WhatsApp turns are handed back to the chat queue so
 * the normal guarded path answers them; every other run starts a new run with
 * the same agent, thread, input and exact instructions.
 */
export async function retryRun(
  runId: string,
  dependencies: RetryDependencies = {},
): Promise<{ strategy: "new_run" | "whatsapp_requeue"; runId: string | null }> {
  const execute = dependencies.execute ?? executeRunInBackground;
  const tickWhatsApp = dependencies.tickWhatsApp ?? tickWhatsAppAutomations;

  if (runRepository.getRun(runId)?.trigger === "whatsapp") {
    const sequences = withImmediateTransaction(() => {
      const run = assertRetryable(runId);
      const requeued = whatsappAutomationRepository.requeueFailedTurn(run.id);
      runRepository.addRunEvent(run.id, "run_retried", {
        strategy: "whatsapp_requeue",
        messageSequences: requeued,
      });
      return requeued;
    });
    await tickWhatsApp().catch(() => {
      // The scheduler tick claims the requeued turn on its next pass.
    });
    const retryRunId = whatsappAutomationRepository.runForMessages(sequences);
    if (retryRunId)
      runRepository.addRunEvent(retryRunId, "run_retry_of", {
        sourceRunId: runId,
      });
    return { strategy: "whatsapp_requeue", runId: retryRunId };
  }

  const retry = withImmediateTransaction(() => {
    const run = assertRetryable(runId);
    const input = conversationRepository.getRunInput(run.id)!;
    const created = createRunExecution({
      agentId: run.agentId,
      threadId: run.threadId!,
      automationId: run.automationId,
      trigger: run.trigger,
      mode: run.mode,
      issueKey: run.issueKey,
      prompt: input.body,
      runInstructions: run.runInstructions,
    });
    runRepository.addRunEvent(created.id, "run_retry_of", {
      sourceRunId: run.id,
    });
    runRepository.addRunEvent(run.id, "run_retried", {
      strategy: "new_run",
      retryRunId: created.id,
    });
    return created;
  });
  void execute(retry.id);
  return { strategy: "new_run", runId: retry.id };
}

function assertRetryable(runId: string) {
  const run = runRepository.getRun(runId);
  if (!run) throw notFound("Run not found");
  const state = getRunRetryState(run, runRepository.listRunEvents(run.id));
  if (!state) throw conflict("Only failed runs can be retried.", "RUN_NOT_FAILED");
  if (state.status === "retried")
    throw conflict("This run was already retried.", "RUN_ALREADY_RETRIED");
  if (state.status === "unavailable")
    throw conflict(state.reason, "RUN_RETRY_UNAVAILABLE");
  return run;
}
