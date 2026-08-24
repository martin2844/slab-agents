import "server-only";

import { durableRunQueue } from "@/lib/durable-run-state";
import type { RunLease } from "@/lib/durable-run-queue";
import { repository } from "@/lib/repository";
import {
  defineRunExecution,
  planRuntimeThread,
  type RunMode,
  type RunTrigger,
} from "@/lib/run-execution";
import { startRunnerRun, type RunnerEvent } from "@/lib/runner";
import { RunnerStreamInterruptedError } from "@/lib/runner-transport";
import { restoreRunProgress } from "@/lib/run-recovery-state";
import { preflightWorkRun } from "@/lib/work-run-preflight-service";

const state = globalThis as unknown as { slabExecutingRuns?: Set<string> };
const executingRuns = (state.slabExecutingRuns ??= new Set<string>());

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
  runId?: string;
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
    id: input.runId,
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

type RunExecutionDependencies = {
  queue?: typeof durableRunQueue;
  preflight?: typeof preflightWorkRun;
  startRunner?: typeof startRunnerRun;
};

export async function* executeRun(
  input: { runId: string },
  dependencies: RunExecutionDependencies = {},
) {
  const queue = dependencies.queue ?? durableRunQueue;
  const runPreflight = dependencies.preflight ?? preflightWorkRun;
  const startRunner = dependencies.startRunner ?? startRunnerRun;
  const run = repository.getRun(input.runId);
  if (!run || !run.threadId) throw new Error("Run or thread not found.");
  const agent = repository.getAgent(run.agentId);
  const thread = repository.getThread(run.threadId);
  const runInput = repository.getRunInput(run.id);
  if (!agent || !thread) throw new Error("Agent or thread not found.");
  if (!runInput) throw new Error("Run input not found.");
  if (executingRuns.has(run.id)) return;
  executingRuns.add(run.id);

  let lease: RunLease | null = null;
  try {
    const admission = queue.acquire(run.id);
    if (admission.queued) {
      repository.addRunEvent(run.id, "run_queued", {
        agentId: agent.id,
        blockedByRunId: admission.blockedByRunId,
        reason: admission.reason,
        durable: true,
        trigger: run.trigger,
        mode: run.mode,
        issueKey: run.issueKey,
      });
      yield {
        type: "run_queued",
        runId: run.id,
        blockedByRunId: admission.blockedByRunId,
        reason: admission.reason,
      };
    }
    lease = await admission.ready;
    if (!lease) return;
    const leaseOwner = lease.ownerId;

    let preflightResult;
    try {
      preflightResult = await runPreflight(run, agent);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Work preflight failed.";
      const persisted = repository.transaction(() => {
        if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
        repository.updateRun(run.id, "failed", { error: message });
        repository.addRunEvent(run.id, "run_failed", {
          error: message,
          phase: "work_preflight",
        });
        return true;
      });
      if (!persisted) return;
      yield { type: "run_failed", error: message, runId: run.id };
      return;
    }
    if (preflightResult && !preflightResult.valid) {
      const persisted = repository.transaction(() => {
        if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
        repository.updateRun(run.id, "skipped");
        repository.addRunEvent(run.id, "run_skipped", {
          reason: preflightResult.reason,
          trigger: run.trigger,
          mode: run.mode,
          issueKey: run.issueKey,
          expectedCondition: preflightResult.expected,
          observedState: preflightResult.observed,
          runtimeStarted: false,
        });
        return true;
      });
      if (!persisted) return;
      yield {
        type: "run_skipped",
        runId: run.id,
        reason: preflightResult.reason,
        issueKey: run.issueKey,
      };
      return;
    }

    const leaseStart = lease.begin();
    if (leaseStart === "maintenance") {
      repository.addRunEvent(run.id, "run_deferred", {
        reason: "maintenance",
        phase: "after_preflight",
      });
      return;
    }
    if (leaseStart !== "started") return;

    const startedPersisted = repository.transaction(() => {
      if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
      repository.updateRun(run.id, "running");
      repository.addRunEvent(run.id, "run_started", {
        trigger: run.trigger,
        mode: run.mode,
        issueKey: run.issueKey,
        automationId: run.automationId,
      });
      return true;
    });
    if (!startedPersisted) return;
    yield {
      type: "run_started",
      runId: run.id,
      trigger: run.trigger,
      mode: run.mode,
      issueKey: run.issueKey,
    };

    const leasedRun = repository.getRun(run.id);
    if (!leasedRun) return;
    const persistedRunEvents = repository.listRunEvents(run.id);
    const persistedProgress = restoreRunProgress(persistedRunEvents);
    let assistantBody = persistedProgress.assistantBody;
    let runnerRunId = leasedRun.runnerRunId ?? run.id;
    let runnerEventCursor = leasedRun.runnerRunId ? leasedRun.runnerEventId : 0;
    const runtimeThreadPlan = planRuntimeThread(
      run.mode,
      thread.runtimeThreadId,
    );
    let runtimeThreadId = runtimeThreadPlan.runtimeThreadId;
    let runtimeContinuity = runtimeThreadPlan.continuity;
    let completed = false;
    const contextProfilePersistence: Promise<void>[] = [];
    let modelCallIndex = persistedProgress.modelCallIndex;
    const runtimeSelectionPersisted = repository.transaction(() => {
      if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
      repository.addRunEvent(run.id, "runtime_thread_selected", {
        runtimeThreadId,
        continuity: runtimeContinuity,
        reusable: runtimeThreadPlan.reusable,
        mode: run.mode,
      });
      return true;
    });
    if (!runtimeSelectionPersisted) return;

    try {
      const messages = repository.listMessages(thread.id);
      for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
        if (!lease.isCurrent()) return;
        const attemptRunnerRunId = runnerRunId;
        const runnerIdentityPersisted = repository.transaction(() => {
          if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
          const currentRunner = repository.getRun(run.id);
          if (currentRunner?.runnerRunId === attemptRunnerRunId) return true;
          return (
            repository.updateRunRunnerCursor(
              run.id,
              leaseOwner,
              attemptRunnerRunId,
              0,
              true,
            ) === 1
          );
        });
        if (!runnerIdentityPersisted) return;
        const runner = await startRunner({
          runId: attemptRunnerRunId,
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
          runnerEventCursor,
        });
        const snapshotPersisted = repository.transaction(() => {
          if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
          const currentRunner = repository.getRun(run.id);
          if (currentRunner?.runnerRunId !== attemptRunnerRunId) return false;
          if (runner.runnerStatus === "waiting_approval") {
            repository.updateRun(run.id, "waiting_approval");
          }
          if (runner.capabilitySnapshot) {
            repository.addRunEvent(run.id, "run_capability_snapshot", {
              ...runner.capabilitySnapshot,
              attempt: attempt + 1,
              runnerRunId: attemptRunnerRunId,
              runtimeResumed: runner.resumed,
            });
          }
          return true;
        });
        if (!snapshotPersisted) return;
        if (!runner.resumed) runnerEventCursor = 0;
        if (runner.contextProfile) {
          contextProfilePersistence.push(
            runner.contextProfile.then((profile) => {
              repository.transaction(() => {
                if (!repository.ownsRunLease(run.id, leaseOwner)) return;
                repository.addRunEvent(run.id, "run_context_profile", {
                  ...profile,
                  attempt: attempt + 1,
                  runnerRunId: attemptRunnerRunId,
                });
              });
            }),
          );
        }
        let rehydrateThread = false;

        for await (const event of runner.events) {
          const eventRunnerRunId = runnerRunId;
          const outcome = repository.transaction(() => {
            if (!repository.ownsRunLease(run.id, leaseOwner)) {
              return { action: "lost" as const };
            }
            const cursorRun = repository.getRun(run.id);
            if (!cursorRun || cursorRun.runnerRunId !== eventRunnerRunId) {
              throw new Error(
                "Runner event identity changed while applying an event.",
              );
            }
            if (event.runId !== eventRunnerRunId) {
              throw new Error("Runner emitted an event for a different run.");
            }
            if (event.id <= cursorRun.runnerEventId) {
              return { action: "duplicate" as const };
            }
            if (event.id !== cursorRun.runnerEventId + 1) {
              throw new Error(
                `Runner event gap: expected ${cursorRun.runnerEventId + 1}, received ${event.id}.`,
              );
            }
            const { data } = event;
            const advance = <T extends Record<string, unknown>>(result: T) => {
              const advanced = repository.updateRunRunnerCursor(
                run.id,
                leaseOwner,
                eventRunnerRunId,
                event.id,
              );
              if (advanced !== 1) {
                throw new Error("Runner event cursor could not be advanced.");
              }
              return result;
            };
            if (event.type === "run.started") {
              repository.addRunEvent(run.id, "runner_run_started", {
                ...data,
                runnerRunId: event.runId,
              });
              return advance({ action: "next" as const });
            }
            if (event.type === "context.bootstrap") {
              repository.addRunEvent(run.id, "runtime_context_bootstrap", {
                ...data,
                attempt: attempt + 1,
                runnerRunId: event.runId,
              });
              return advance({ action: "next" as const });
            }
            if (event.type === "assistant.delta") {
              const delta = String(data.delta ?? "");
              return advance({
                action: "next" as const,
                assistantBody: assistantBody + delta,
                browser: {
                  type: "assistant_delta",
                  delta,
                  runId: event.runId,
                },
              });
            }
            if (event.type === "assistant.completed") {
              const body = String(data.message ?? assistantBody);
              repository.addRunEvent(run.id, "assistant_message", {
                body,
              });
              return advance({
                action: "next" as const,
                assistantBody: body || assistantBody,
                browser: {
                  type: "assistant_message",
                  body: body || assistantBody,
                  runId: event.runId,
                },
              });
            }
            if (event.type === "thread.created") {
              const createdThreadId = String(data.runtimeThreadId ?? "");
              if (createdThreadId) {
                if (runtimeThreadPlan.reusable) {
                  repository.setRuntimeThread(thread.id, createdThreadId);
                }
              }
              repository.addRunEvent(run.id, "thread_created", {
                runtimeThreadId: createdThreadId,
                continuity: "fresh",
                reusable: runtimeThreadPlan.reusable,
              });
              return advance({
                action: "next" as const,
                runtimeThreadId: createdThreadId || runtimeThreadId,
                runtimeContinuity: createdThreadId
                  ? ("fresh" as const)
                  : runtimeContinuity,
              });
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
              return advance({
                action: "next" as const,
                browser: {
                  ...browserEvent("approval_required", event),
                  approvalId: approval.id,
                },
              });
            }
            if (event.type === "approval.resolved") {
              repository.addRunEvent(run.id, "approval_resolved", data);
              return advance({ action: "next" as const });
            }
            if (event.type === "usage.updated") {
              const nextModelCallIndex = modelCallIndex + 1;
              const usage = {
                ...data,
                runnerCallIndex: data.callIndex,
                callIndex: nextModelCallIndex,
                runnerRunId: event.runId,
                attempt: attempt + 1,
              };
              const status = repository.getRun(run.id)?.status ?? "running";
              repository.updateRun(run.id, status, { usage });
              repository.addRunEvent(run.id, "usage_updated", usage);
              return advance({
                action: "next" as const,
                modelCallIndex: nextModelCallIndex,
              });
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
              return advance({
                action: "next" as const,
                browser: browserEvent(type, event),
              });
            }
            if (event.type === "runtime.warning") {
              repository.addRunEvent(run.id, "runtime_warning", {
                ...data,
                runnerRunId: event.runId,
                attempt: attempt + 1,
              });
              return advance({ action: "next" as const });
            }
            if (event.type === "run.failed") {
              const failure = runtimeFailure(data);
              if (
                attempt === 0 &&
                runtimeThreadId &&
                failure.code === "THREAD_NOT_FOUND"
              ) {
                const previousRuntimeThreadId = runtimeThreadId;
                const rehydratedRunnerRunId = `${run.id}-rehydrated`;
                repository.setRuntimeThread(thread.id, null);
                if (
                  repository.updateRunRunnerCursor(
                    run.id,
                    leaseOwner,
                    rehydratedRunnerRunId,
                    0,
                    true,
                  ) !== 1
                ) {
                  throw new Error(
                    "Runner identity could not be reset for thread rehydration.",
                  );
                }
                repository.addRunEvent(run.id, "runtime_thread_recreated", {
                  previousRuntimeThreadId,
                  runnerRunId: rehydratedRunnerRunId,
                });
                return {
                  action: "rehydrate" as const,
                  runnerRunId: rehydratedRunnerRunId,
                };
              }
              const closedApprovals = repository.closePendingApprovals(run.id);
              repository.updateRun(run.id, "failed", {
                error: failure.message,
              });
              repository.addRunEvent(run.id, "run_failed", {
                error: failure.message,
                closedApprovals,
              });
              return advance({
                action: "failed" as const,
                browser: {
                  type: "run_failed",
                  error: failure.message,
                  runId: run.id,
                },
              });
            }
            if (event.type === "run.cancelled") {
              repository.closePendingApprovals(run.id);
              repository.updateRun(run.id, "cancelled");
              repository.addRunEvent(run.id, "run_cancelled", data);
              return advance({
                action: "cancelled" as const,
                browser: browserEvent("run_cancelled", event),
              });
            }
            if (event.type === "run.completed") {
              const completedData = {
                ...data,
                runtimeThreadId:
                  data.runtimeThreadId ?? runtimeThreadId ?? null,
                runtimeContinuity,
              };
              if (assistantBody) {
                repository.addRunMessageOnce(
                  thread.id,
                  run.id,
                  "assistant",
                  assistantBody,
                );
              }
              repository.updateRun(run.id, "completed");
              repository.addRunEvent(run.id, "run_completed", completedData);
              return advance({
                action: "completed" as const,
                browser: browserEvent("run_completed", event, completedData),
              });
            }
            return advance({ action: "next" as const });
          });

          if (outcome.action === "lost") return;
          if (outcome.action === "duplicate") continue;
          runnerEventCursor = event.id;
          if ("assistantBody" in outcome) {
            assistantBody = String(outcome.assistantBody ?? assistantBody);
          }
          if ("modelCallIndex" in outcome) {
            modelCallIndex = Number(outcome.modelCallIndex);
          }
          if ("runtimeThreadId" in outcome) {
            runtimeThreadId =
              typeof outcome.runtimeThreadId === "string"
                ? outcome.runtimeThreadId
                : null;
            if (
              "runtimeContinuity" in outcome &&
              outcome.runtimeContinuity === "fresh"
            ) {
              runtimeContinuity = "fresh";
            }
          }
          if ("browser" in outcome && outcome.browser) {
            yield outcome.browser;
          }
          if (outcome.action === "rehydrate") {
            runnerRunId = outcome.runnerRunId;
            runnerEventCursor = 0;
            runtimeThreadId = null;
            runtimeContinuity = "fresh";
            assistantBody = "";
            rehydrateThread = true;
            break;
          }
          if (outcome.action === "failed" || outcome.action === "cancelled") {
            return;
          }
          if (outcome.action === "completed") {
            completed = true;
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown runner error";
      if (error instanceof RunnerStreamInterruptedError) {
        const requeued = repository.transaction(() => {
          if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
          if (
            repository.requeueRunForRunnerReconnect(
              run.id,
              leaseOwner,
              message,
            ) !== 1
          ) {
            return false;
          }
          repository.addRunEvent(run.id, "runner_stream_interrupted", {
            error: message,
            runnerRunId,
            runnerEventCursor,
          });
          return true;
        });
        if (!requeued) return;
        yield {
          type: "run_queued",
          runId: run.id,
          reason: "runner_reconnect",
        };
        return;
      }
      const persisted = repository.transaction(() => {
        if (!repository.ownsRunLease(run.id, leaseOwner)) return false;
        const closedApprovals = repository.closePendingApprovals(run.id);
        repository.updateRun(run.id, "failed", { error: message });
        repository.addRunEvent(run.id, "run_failed", {
          error: message,
          closedApprovals,
        });
        return true;
      });
      if (!persisted) return;
      yield { type: "run_failed", error: message, runId: run.id };
    }
  } finally {
    lease?.release();
    executingRuns.delete(run.id);
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
  scheduledFor: Date | null = null,
) {
  const automation = repository.getAutomation(automationId);
  if (!automation) throw new Error("Automation not found");
  const agent = repository.getAgent(automation.agentId);
  if (!agent) throw new Error("Agent not found");
  if (!agent.enabled) throw new Error("This agent is disabled.");

  if (scheduledFor) {
    const scheduledForIso = scheduledFor.toISOString();
    const occurrence = repository.claimAutomationOccurrence(
      automation.id,
      scheduledForIso,
    );
    let created = false;
    const run = repository.transaction(() => {
      const existing = repository.getRun(occurrence.runId);
      if (existing) return existing;
      const thread = repository.createThread(agent.id, automation.name);
      const scheduledRun = createRunExecution({
        runId: occurrence.runId,
        agentId: agent.id,
        threadId: thread.id,
        automationId: automation.id,
        trigger,
        mode: automation.mode,
        prompt: automation.prompt,
      });
      repository.addRunEvent(scheduledRun.id, "automation_occurrence_claimed", {
        automationId: automation.id,
        scheduledFor: scheduledForIso,
        missedRunPolicy: automation.missedRunPolicy,
      });
      const marked = repository.markAutomationOccurrenceDispatched(
        automation.id,
        scheduledForIso,
        scheduledRun.id,
      );
      if (marked !== 1) {
        throw new Error("Automation occurrence was already dispatched.");
      }
      repository.updateAutomation(automation.id, {
        lastRunAt: startedAt.toISOString(),
        lastScheduledFor: scheduledForIso,
      });
      created = true;
      return scheduledRun;
    });
    if (created) void executeRunInBackground(run.id);
    return run;
  }

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
