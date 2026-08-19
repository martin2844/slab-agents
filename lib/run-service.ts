import "server-only";

import { AgentRunQueue } from "@/lib/agent-run-queue";
import { repository } from "@/lib/repository";
import {
  defineRunExecution,
  planRuntimeThread,
  type RunMode,
  type RunTrigger,
} from "@/lib/run-execution";
import { startRunnerRun, type RunnerEvent } from "@/lib/runner";
import { preflightWorkRun } from "@/lib/work-run-preflight-service";

const state = globalThis as unknown as { slabAgentRunQueue?: AgentRunQueue };
const agentRunQueue = (state.slabAgentRunQueue ??= new AgentRunQueue());

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

export function createRunExecution(input: {
  agentId: string;
  threadId: string;
  trigger: RunTrigger;
  mode: RunMode;
  prompt: string;
  issueKey?: string | null;
  automationId?: string | null;
  eventInstructions?: string | null;
}) {
  const agent = repository.getAgent(input.agentId);
  const thread = repository.getThread(input.threadId);
  if (!agent || !thread || thread.agentId !== agent.id) {
    throw new Error("Agent or thread not found.");
  }
  const execution = defineRunExecution(input);
  const run = repository.createRun({
    agentId: agent.id,
    threadId: thread.id,
    automationId: input.automationId,
    runtime: agent.runtime,
    trigger: execution.trigger,
    mode: execution.mode,
    issueKey: execution.issueKey,
    runInstructions: execution.policy,
  });
  repository.addMessage(thread.id, run.id, "user", input.prompt);
  repository.addRunEvent(run.id, "run_execution_created", {
    trigger: execution.trigger,
    mode: execution.mode,
    issueKey: execution.issueKey,
    automationId: input.automationId ?? null,
  });
  return run;
}

export async function* executeRun(input: { runId: string }) {
  const run = repository.getRun(input.runId);
  if (!run || !run.threadId) throw new Error("Run or thread not found.");
  const agent = repository.getAgent(run.agentId);
  const thread = repository.getThread(run.threadId);
  const runInput = repository.getRunInput(run.id);
  if (!agent || !thread) throw new Error("Agent or thread not found.");
  if (!runInput) throw new Error("Run input not found.");

  const admission = agentRunQueue.acquire(agent.id, run.id);
  if (admission.queued) {
    repository.addRunEvent(run.id, "run_queued", {
      agentId: agent.id,
      blockedByRunId: agentRunQueue.activeRun(agent.id),
      trigger: run.trigger,
      mode: run.mode,
      issueKey: run.issueKey,
    });
    yield {
      type: "run_queued",
      runId: run.id,
      blockedByRunId: agentRunQueue.activeRun(agent.id),
    };
  }
  await admission.ready;

  try {
    let preflight;
    try {
      preflight = await preflightWorkRun(run, agent);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Work preflight failed.";
      repository.updateRun(run.id, "failed", { error: message });
      repository.addRunEvent(run.id, "run_failed", {
        error: message,
        phase: "work_preflight",
      });
      yield { type: "run_failed", error: message, runId: run.id };
      return;
    }
    if (preflight && !preflight.valid) {
      repository.updateRun(run.id, "skipped");
      repository.addRunEvent(run.id, "run_skipped", {
        reason: preflight.reason,
        trigger: run.trigger,
        mode: run.mode,
        issueKey: run.issueKey,
        expectedCondition: preflight.expected,
        observedState: preflight.observed,
        runtimeStarted: false,
      });
      yield {
        type: "run_skipped",
        runId: run.id,
        reason: preflight.reason,
        issueKey: run.issueKey,
      };
      return;
    }

    repository.updateRun(run.id, "running");
    repository.addRunEvent(run.id, "run_started", {
      trigger: run.trigger,
      mode: run.mode,
      issueKey: run.issueKey,
      automationId: run.automationId,
    });
    yield {
      type: "run_started",
      runId: run.id,
      trigger: run.trigger,
      mode: run.mode,
      issueKey: run.issueKey,
    };

    let assistantBody = "";
    let runnerRunId = run.id;
    const runtimeThreadPlan = planRuntimeThread(
      run.mode,
      thread.runtimeThreadId,
    );
    let runtimeThreadId = runtimeThreadPlan.runtimeThreadId;
    let runtimeContinuity = runtimeThreadPlan.continuity;
    let completed = false;
    const contextProfilePersistence: Promise<void>[] = [];
    let modelCallIndex = 0;
    repository.addRunEvent(run.id, "runtime_thread_selected", {
      runtimeThreadId,
      continuity: runtimeContinuity,
      reusable: runtimeThreadPlan.reusable,
      mode: run.mode,
    });

    try {
      const messages = repository.listMessages(thread.id);
      for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
        const runner = await startRunnerRun({
          runId: runnerRunId,
          controlPlaneRunId: run.id,
          agent,
          thread: { ...thread, runtimeThreadId },
          messages,
          prompt: runInput.body,
          execution: {
            trigger: run.trigger,
            mode: run.mode,
            issueKey: run.issueKey,
            policy: run.runInstructions,
          },
        });
        repository.addRunEvent(run.id, "run_capability_snapshot", {
          ...runner.capabilitySnapshot,
          attempt: attempt + 1,
          runnerRunId,
        });
        contextProfilePersistence.push(
          runner.contextProfile.then((profile) => {
            repository.addRunEvent(run.id, "run_context_profile", {
              ...profile,
              attempt: attempt + 1,
              runnerRunId,
            });
          }),
        );
        let rehydrateThread = false;

        for await (const event of runner.events) {
          const { data } = event;
          if (event.type === "run.started") {
            repository.addRunEvent(run.id, "runner_run_started", {
              runnerRunId: event.runId,
            });
            continue;
          }
          if (event.type === "context.bootstrap") {
            repository.addRunEvent(run.id, "runtime_context_bootstrap", {
              ...data,
              attempt: attempt + 1,
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
              runtimeContinuity = "fresh";
              if (runtimeThreadPlan.reusable) {
                repository.setRuntimeThread(thread.id, createdThreadId);
              }
            }
            repository.addRunEvent(run.id, "thread_created", {
              runtimeThreadId: createdThreadId,
              continuity: "fresh",
              reusable: runtimeThreadPlan.reusable,
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
            modelCallIndex += 1;
            const usage = {
              ...data,
              runnerCallIndex: data.callIndex,
              callIndex: modelCallIndex,
              runnerRunId: event.runId,
              attempt: attempt + 1,
            };
            const status = repository.getRun(run.id)?.status ?? "running";
            repository.updateRun(run.id, status, { usage });
            repository.addRunEvent(run.id, "usage_updated", usage);
            continue;
          }
          if (
            event.type === "tool.started" ||
            event.type === "tool.completed" ||
            event.type === "tool.failed"
          ) {
            const type = event.type.replace(".", "_");
            repository.addRunEvent(run.id, type, {
              ...data,
              runnerRunId: event.runId,
              attempt: attempt + 1,
            });
            yield browserEvent(type, event);
            continue;
          }
          if (event.type === "runtime.warning") {
            repository.addRunEvent(run.id, "runtime_warning", {
              ...data,
              runnerRunId: event.runId,
              attempt: attempt + 1,
            });
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
              runtimeContinuity = "fresh";
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
            const completedData = {
              ...data,
              runtimeThreadId: data.runtimeThreadId ?? runtimeThreadId ?? null,
              runtimeContinuity,
            };
            repository.addRunEvent(run.id, "run_completed", completedData);
            yield browserEvent("run_completed", event, completedData);
          }
        }

        if (rehydrateThread) continue;
        if (!completed) {
          throw new Error(
            "Runner event stream ended before the run completed.",
          );
        }
      }

      if (!completed) throw new Error("Runner could not rehydrate the thread.");
      await Promise.all(contextProfilePersistence);
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
  } finally {
    agentRunQueue.release(agent.id, run.id);
  }
}

export async function executeRunInBackground(runId: string) {
  for await (const event of executeRun({ runId })) {
    void event; /* persist all events; no browser consumer */
  }
}

export function startAutomationRun(
  automationId: string,
  trigger: Extract<RunTrigger, "manual" | "automation">,
  startedAt = new Date(),
) {
  const automation = repository.getAutomation(automationId);
  if (!automation) throw new Error("Automation not found");
  const agent = repository.getAgent(automation.agentId);
  if (!agent) throw new Error("Agent not found");
  if (!agent.enabled) throw new Error("This agent is disabled.");

  const thread = repository.createThread(agent.id, automation.name);
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    automationId: automation.id,
    trigger,
    mode: automation.mode,
    prompt: automation.prompt,
  });
  repository.updateAutomation(automation.id, {
    lastRunAt: startedAt.toISOString(),
  });
  void executeRunInBackground(run.id);
  return run;
}
