import "server-only";

import { repository } from "@/lib/repository";
import { startRunnerRun, type RunnerEvent } from "@/lib/runner";

function runtimeFailure(data: Record<string, unknown>) {
  const error = data.error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      code: String(value.code ?? "UNKNOWN_RUNTIME_ERROR"),
      message: String(value.message ?? "Runner failed."),
    };
  }
  return {
    code: "UNKNOWN_RUNTIME_ERROR",
    message: typeof error === "string" ? error : "Runner failed.",
  };
}

function browserEvent(
  type: string,
  event: RunnerEvent,
  data: Record<string, unknown> = event.data,
) {
  return { type, runId: event.runId, ...data };
}

export async function* executeRun(input: { runId: string; prompt: string }) {
  const run = repository.getRun(input.runId);
  if (!run || !run.threadId) throw new Error("Run or thread not found.");
  const agent = repository.getAgent(run.agentId);
  const thread = repository.getThread(run.threadId);
  if (!agent || !thread) throw new Error("Agent or thread not found.");

  repository.updateRun(run.id, "running");
  repository.addRunEvent(run.id, "run_started", {
    source: run.automationId ? "automation" : "chat",
  });
  yield { type: "run_started", runId: run.id };

  let assistantBody = "";
  let runnerRunId = run.id;
  let runtimeThreadId = thread.runtimeThreadId;
  let completed = false;

  try {
    const messages = repository.listMessages(thread.id);
    for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
      const events = await startRunnerRun({
        runId: runnerRunId,
        agent,
        thread: { ...thread, runtimeThreadId },
        messages,
        prompt: input.prompt,
      });
      let rehydrateThread = false;

      for await (const event of events) {
        const { data } = event;
        if (event.type === "run.started") {
          repository.addRunEvent(run.id, "runner_run_started", {
            runnerRunId: event.runId,
          });
          continue;
        }
        if (event.type === "assistant.delta") {
          const delta = String(data.delta ?? "");
          assistantBody += delta;
          yield { type: "assistant_delta", delta, runId: event.runId };
          continue;
        }
        if (event.type === "assistant.completed") {
          const body = String(data.message ?? assistantBody);
          if (body) assistantBody = body;
          repository.addRunEvent(run.id, "assistant_message", {
            body: assistantBody,
          });
          yield {
            type: "assistant_message",
            body: assistantBody,
            runId: event.runId,
          };
          continue;
        }
        if (event.type === "thread.created") {
          const createdThreadId = String(data.runtimeThreadId ?? "");
          if (createdThreadId) {
            runtimeThreadId = createdThreadId;
            repository.setRuntimeThread(thread.id, createdThreadId);
          }
          repository.addRunEvent(run.id, "thread_created", {
            runtimeThreadId: createdThreadId,
          });
          continue;
        }
        if (event.type === "approval.required") {
          const runnerApprovalId = String(
            data.approvalId ?? crypto.randomUUID(),
          );
          const command = String(
            data.command ??
              data.reason ??
              data.message ??
              data.description ??
              "Runtime action",
          );
          const approval = repository.createApproval(
            run.id,
            runnerApprovalId,
            command,
            { ...data, runnerRunId: event.runId },
          );
          repository.updateRun(run.id, "waiting_approval");
          repository.addRunEvent(run.id, "approval_required", {
            ...data,
            approvalId: approval.id,
            runnerRunId: event.runId,
          });
          yield {
            ...browserEvent("approval_required", event),
            approvalId: approval.id,
          };
          continue;
        }
        if (event.type === "approval.resolved") {
          repository.addRunEvent(run.id, "approval_resolved", data);
          continue;
        }
        if (event.type === "usage.updated") {
          const status = repository.getRun(run.id)?.status ?? "running";
          repository.updateRun(run.id, status, { usage: data });
          repository.addRunEvent(run.id, "usage_updated", data);
          continue;
        }
        if (event.type === "tool.started" || event.type === "tool.completed") {
          const type = event.type.replace(".", "_");
          repository.addRunEvent(run.id, type, data);
          yield browserEvent(type, event);
          continue;
        }
        if (event.type === "run.failed") {
          const failure = runtimeFailure(data);
          if (
            attempt === 0 &&
            runtimeThreadId &&
            failure.code === "THREAD_NOT_FOUND"
          ) {
            const previousRuntimeThreadId = runtimeThreadId;
            runtimeThreadId = null;
            runnerRunId = `${run.id}-rehydrated`;
            assistantBody = "";
            repository.setRuntimeThread(thread.id, null);
            repository.addRunEvent(run.id, "runtime_thread_recreated", {
              previousRuntimeThreadId,
              runnerRunId,
            });
            rehydrateThread = true;
            break;
          }
          throw new Error(failure.message);
        }
        if (event.type === "run.cancelled") {
          repository.closePendingApprovals(run.id);
          repository.updateRun(run.id, "cancelled");
          repository.addRunEvent(run.id, "run_cancelled", data);
          yield browserEvent("run_cancelled", event);
          return;
        }
        if (event.type === "run.completed") {
          completed = true;
          repository.addRunEvent(run.id, "run_completed", data);
          yield browserEvent("run_completed", event);
        }
      }

      if (rehydrateThread) continue;
      if (!completed) {
        throw new Error("Runner event stream ended before the run completed.");
      }
    }

    if (!completed) throw new Error("Runner could not rehydrate the thread.");
    if (assistantBody) {
      repository.addMessage(thread.id, run.id, "assistant", assistantBody);
    }
    repository.updateRun(run.id, "completed");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown runner error";
    const closedApprovals = repository.closePendingApprovals(run.id);
    repository.updateRun(run.id, "failed", { error: message });
    repository.addRunEvent(run.id, "run_failed", {
      error: message,
      closedApprovals,
    });
    yield { type: "run_failed", error: message, runId: run.id };
  }
}

export async function executeAutomationRun(runId: string, prompt: string) {
  for await (const event of executeRun({ runId, prompt })) {
    void event; /* persist all events; no browser consumer */
  }
}
