import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { withImmediateTransaction } from "@/lib/db/transaction";

import { OperationalError } from "@/lib/operational-error";
import { presentApproval } from "@/lib/approval-presentation";

import { durableRunQueue } from "@/lib/repositories/durable-run-queue-repository";
import type { RunLease } from "@/lib/repositories/run-queue-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import {
  defineRunExecution,
  planRuntimeThread,
  type RunMode,
  type RunTrigger,
} from "@/lib/run-execution";
import {
  cancelRunnerRun,
  startRunnerRun,
  type RunnerEvent,
} from "@/lib/runner";
import { RunnerBudgetCompatibilityError } from "@/lib/runner-errors";
import { RunnerStreamInterruptedError } from "@/lib/runner-transport";
import { restoreRunProgress } from "@/lib/run-recovery-state";
import { preflightWorkRun } from "@/lib/work-run-preflight-service";
import {
  assertRuntimeSelectable,
  resolveRuntimeModel,
} from "@/lib/runtime-config";
import {
  admitRunBudget,
  observeRunUsage,
  markRunBudgetExceeded,
  settleRunBudget,
  releaseRunBudgetWithoutRuntime,
  type BudgetAdmission,
} from "@/lib/budget-control";

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
  const agent = agentRepository.getAgent(input.agentId);
  const thread = conversationRepository.getThread(input.threadId);
  if (!agent || !thread || thread.agentId !== agent.id) {
    throw new Error("Agent or thread not found.");
  }
  assertRuntimeSelectable(agent.runtime, agent.model);
  const model = resolveRuntimeModel(agent.runtime, agent.model);
  const execution = defineRunExecution(input);
  return withImmediateTransaction(() => {
    const run = runRepository.createRun({
      id: input.runId,
      agentId: agent.id,
      threadId: thread.id,
      automationId: input.automationId,
      runtime: agent.runtime,
      model,
      trigger: execution.trigger,
      mode: execution.mode,
      issueKey: execution.issueKey,
      runInstructions: execution.policy,
    });
    conversationRepository.addMessage(thread.id, run.id, "user", input.prompt);
    runRepository.addRunEvent(run.id, "run_execution_created", {
      trigger: execution.trigger,
      mode: execution.mode,
      issueKey: execution.issueKey,
      automationId: input.automationId ?? null,
    });
    return run;
  });
}

type RunExecutionDependencies = {
  queue?: typeof durableRunQueue;
  preflight?: typeof preflightWorkRun;
  startRunner?: typeof startRunnerRun;
  admitBudget?: typeof admitRunBudget;
  observeBudget?: typeof observeRunUsage;
  markBudgetExceeded?: typeof markRunBudgetExceeded;
  settleBudget?: typeof settleRunBudget;
  releaseBudgetWithoutRuntime?: typeof releaseRunBudgetWithoutRuntime;
  cancelRunner?: typeof cancelRunnerRun;
};

export async function* executeRun(
  input: { runId: string },
  dependencies: RunExecutionDependencies = {},
) {
  const queue = dependencies.queue ?? durableRunQueue;
  const runPreflight = dependencies.preflight ?? preflightWorkRun;
  const startRunner = dependencies.startRunner ?? startRunnerRun;
  const admitBudget = dependencies.admitBudget ?? admitRunBudget;
  const observeBudget = dependencies.observeBudget ?? observeRunUsage;
  const markBudgetExceeded =
    dependencies.markBudgetExceeded ?? markRunBudgetExceeded;
  const settleBudget = dependencies.settleBudget ?? settleRunBudget;
  const releaseBudgetWithoutRuntime =
    dependencies.releaseBudgetWithoutRuntime ?? releaseRunBudgetWithoutRuntime;
  const cancelRunner = dependencies.cancelRunner ?? cancelRunnerRun;
  const run = runRepository.getRun(input.runId);
  if (!run || !run.threadId) throw new Error("Run or thread not found.");
  const agent = agentRepository.getAgent(run.agentId);
  const thread = conversationRepository.getThread(run.threadId);
  const runInput = conversationRepository.getRunInput(run.id);
  if (!agent || !thread) throw new Error("Agent or thread not found.");
  if (!runInput) throw new Error("Run input not found.");
  if (executingRuns.has(run.id)) return;
  executingRuns.add(run.id);

  let lease: RunLease | null = null;
  try {
    const admission = queue.acquire(run.id);
    if (admission.queued) {
      runRepository.addRunEvent(run.id, "run_queued", {
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
      const persisted = withImmediateTransaction(() => {
        if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
        runRepository.updateRun(run.id, "failed", { error: message });
        runRepository.addRunEvent(run.id, "run_failed", {
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
      const persisted = withImmediateTransaction(() => {
        if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
        runRepository.updateRun(run.id, "skipped");
        runRepository.addRunEvent(run.id, "run_skipped", {
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
      runRepository.addRunEvent(run.id, "run_deferred", {
        reason: "maintenance",
        phase: "after_preflight",
      });
      return;
    }
    if (leaseStart !== "started") return;

    let budgetAdmission: BudgetAdmission;
    try {
      budgetAdmission = admitBudget(run, agent);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Budget admission failed.";
      const persisted = withImmediateTransaction(() => {
        if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
        runRepository.updateRun(run.id, "failed", { error: message });
        runRepository.addRunEvent(run.id, "run_failed", {
          error: message,
          phase: "budget_admission",
          runtimeStarted: false,
        });
        return true;
      });
      if (!persisted) return;
      yield { type: "run_failed", error: message, runId: run.id };
      return;
    }
    if (!budgetAdmission.allowed) {
      const persisted = withImmediateTransaction(() => {
        if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
        runRepository.updateRun(run.id, "skipped");
        runRepository.addRunEvent(run.id, "run_budget_rejected", {
          reason: budgetAdmission.reason,
          budget: budgetAdmission.snapshot,
          runtimeStarted: false,
        });
        runRepository.addRunEvent(run.id, "run_skipped", {
          reason: "budget_rejected",
          budgetReason: budgetAdmission.reason,
          runtimeStarted: false,
        });
        return true;
      });
      if (!persisted) return;
      yield {
        type: "run_skipped",
        runId: run.id,
        reason: "budget_rejected",
      };
      return;
    }

    const requestBudgetCancellation = async (runnerRunId: string) => {
      try {
        return await cancelRunner(runnerRunId);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Runner cancellation could not be confirmed.";
        withImmediateTransaction(() => {
          if (!runRepository.ownsRunLease(run.id, leaseOwner)) return;
          runRepository.addRunEvent(run.id, "run_budget_cancel_failed", {
            error: message,
            runnerRunId,
            retryable: true,
          });
        });
        throw new RunnerStreamInterruptedError(
          `Budget cancellation could not be confirmed: ${message}`,
        );
      }
    };

    const startedPersisted = withImmediateTransaction(() => {
      if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
      runRepository.updateRun(run.id, "running");
      runRepository.addRunEvent(run.id, "run_budget_reserved", {
        budget: budgetAdmission.snapshot,
      });
      runRepository.addRunEvent(run.id, "run_started", {
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

    const leasedRun = runRepository.getRun(run.id);
    if (!leasedRun) return;
    const persistedRunEvents = runRepository.listRunEvents(run.id);
    const persistedProgress = restoreRunProgress(persistedRunEvents);
    let assistantBody = persistedProgress.assistantBody;
    let runnerRunId = leasedRun.runnerRunId ?? run.id;
    let runnerEventCursor = leasedRun.runnerRunId ? leasedRun.runnerEventId : 0;
    const runtimeThreadPlan = planRuntimeThread(
      run.mode,
      thread.runtime === run.runtime ? thread.runtimeThreadId : null,
    );
    let runtimeThreadId = runtimeThreadPlan.runtimeThreadId;
    let runtimeContinuity = runtimeThreadPlan.continuity;
    let completed = false;
    const contextProfilePersistence: Promise<void>[] = [];
    let modelCallIndex = persistedProgress.modelCallIndex;
    const runtimeSelectionPersisted = withImmediateTransaction(() => {
      if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
      runRepository.addRunEvent(run.id, "runtime_thread_selected", {
        runtimeThreadId,
        continuity: runtimeContinuity,
        reusable: runtimeThreadPlan.reusable,
        mode: run.mode,
      });
      return true;
    });
    if (!runtimeSelectionPersisted) return;

    try {
      const messages = conversationRepository.listMessages(thread.id);
      for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
        if (!lease.isCurrent()) return;
        const attemptRunnerRunId = runnerRunId;
        const runnerIdentityPersisted = withImmediateTransaction(() => {
          if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
          const currentRunner = runRepository.getRun(run.id);
          if (currentRunner?.runnerRunId === attemptRunnerRunId) return true;
          return (
            runRepository.updateRunRunnerCursor(
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
          agent: { ...agent, runtime: run.runtime, model: run.model },
          thread: { ...thread, runtimeThreadId },
          messages,
          prompt: runInput.body,
          execution: {
            trigger: run.trigger,
            mode: run.mode,
            issueKey: run.issueKey,
            policy: run.runInstructions,
          },
          budget: budgetAdmission.runtimeBudget,
          attachOnly: budgetAdmission.snapshot.status === "exceeded",
          runnerEventCursor,
        });
        if (budgetAdmission.snapshot.status === "exceeded") {
          await requestBudgetCancellation(attemptRunnerRunId);
        }
        const snapshotPersisted = withImmediateTransaction(() => {
          if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
          const currentRunner = runRepository.getRun(run.id);
          if (currentRunner?.runnerRunId !== attemptRunnerRunId) return false;
          if (runner.runnerStatus === "waiting_approval") {
            runRepository.updateRun(run.id, "waiting_approval");
          }
          if (runner.capabilitySnapshot) {
            runRepository.addRunEvent(run.id, "run_capability_snapshot", {
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
              withImmediateTransaction(() => {
                if (!runRepository.ownsRunLease(run.id, leaseOwner)) return;
                runRepository.addRunEvent(run.id, "run_context_profile", {
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
          const outcome = withImmediateTransaction(() => {
            if (!runRepository.ownsRunLease(run.id, leaseOwner)) {
              return { action: "lost" as const };
            }
            const cursorRun = runRepository.getRun(run.id);
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
              const advanced = runRepository.updateRunRunnerCursor(
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
              runRepository.addRunEvent(run.id, "runner_run_started", {
                ...data,
                runnerRunId: event.runId,
              });
              return advance({ action: "next" as const });
            }
            if (event.type === "context.bootstrap") {
              runRepository.addRunEvent(run.id, "runtime_context_bootstrap", {
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
              runRepository.addRunEvent(run.id, "assistant_message", {
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
                  conversationRepository.setRuntimeThread(
                    thread.id,
                    createdThreadId,
                    run.runtime,
                  );
                }
              }
              runRepository.addRunEvent(run.id, "thread_created", {
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
              const presentation = presentApproval(data);
              const runnerApprovalId = String(
                data.approvalId ?? crypto.randomUUID(),
              );
              const approval = approvalRepository.create(
                run.id,
                runnerApprovalId,
                presentation.command,
                { ...presentation.details, runnerRunId: event.runId },
              );
              runRepository.updateRun(run.id, "waiting_approval");
              runRepository.addRunEvent(run.id, "approval_required", {
                ...presentation.details,
                command: presentation.command,
                approvalId: approval.id,
                runnerRunId: event.runId,
              });
              return advance({
                action: "next" as const,
                browser: {
                  ...browserEvent("approval_required", event, {
                    ...presentation.details,
                    command: presentation.command,
                  }),
                  approvalId: approval.id,
                },
              });
            }
            if (event.type === "approval.resolved") {
              runRepository.addRunEvent(run.id, "approval_resolved", data);
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
              const status = runRepository.getRun(run.id)?.status ?? "running";
              runRepository.updateRun(run.id, status, { usage });
              runRepository.addRunEvent(run.id, "usage_updated", usage);
              const budgetOutcome = observeBudget(
                run.id,
                `${event.runId}:${event.id}`,
                data,
              );
              if (budgetOutcome?.newlyExceeded) {
                runRepository.addRunEvent(run.id, "run_budget_exceeded", {
                  reason: budgetOutcome.reason,
                  budget: budgetOutcome.snapshot,
                  runnerRunId: event.runId,
                });
              }
              return advance({
                action: "next" as const,
                modelCallIndex: nextModelCallIndex,
                cancelForBudget: budgetOutcome?.newlyExceeded === true,
              });
            }
            if (
              event.type === "tool.started" ||
              event.type === "tool.completed" ||
              event.type === "tool.failed"
            ) {
              const type = event.type.replace(".", "_");
              runRepository.addRunEvent(run.id, type, {
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
              runRepository.addRunEvent(run.id, "runtime_warning", {
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
                conversationRepository.setRuntimeThread(thread.id, null);
                if (
                  runRepository.updateRunRunnerCursor(
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
                runRepository.addRunEvent(run.id, "runtime_thread_recreated", {
                  previousRuntimeThreadId,
                  runnerRunId: rehydratedRunnerRunId,
                });
                return {
                  action: "rehydrate" as const,
                  runnerRunId: rehydratedRunnerRunId,
                };
              }
              const budgetOutcome =
                failure.code === "RUNTIME_BUDGET_EXCEEDED"
                  ? markBudgetExceeded(run.id)
                  : null;
              if (budgetOutcome?.newlyExceeded) {
                runRepository.addRunEvent(run.id, "run_budget_exceeded", {
                  reason: budgetOutcome.reason,
                  budget: budgetOutcome.snapshot,
                  runnerRunId: event.runId,
                });
              }
              const closedApprovals = approvalRepository.closePending(run.id);
              runRepository.updateRun(run.id, "failed", {
                error: failure.message,
              });
              runRepository.addRunEvent(run.id, "run_failed", {
                error: failure.message,
                closedApprovals,
              });
              settleBudget(run.id, "failed");
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
              approvalRepository.closePending(run.id);
              runRepository.updateRun(run.id, "cancelled");
              runRepository.addRunEvent(run.id, "run_cancelled", data);
              settleBudget(run.id, "cancelled");
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
                conversationRepository.addRunMessageOnce(
                  thread.id,
                  run.id,
                  "assistant",
                  assistantBody,
                );
              }
              runRepository.updateRun(run.id, "completed");
              runRepository.addRunEvent(run.id, "run_completed", completedData);
              settleBudget(run.id, "completed");
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
          if ("cancelForBudget" in outcome && outcome.cancelForBudget) {
            await requestBudgetCancellation(eventRunnerRunId);
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
      if (error instanceof RunnerBudgetCompatibilityError) {
        const persisted = withImmediateTransaction(() => {
          if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
          const closedApprovals = approvalRepository.closePending(run.id);
          runRepository.updateRun(run.id, "failed", { error: message });
          runRepository.addRunEvent(run.id, "run_failed", {
            error: message,
            closedApprovals,
            phase: "runner_budget_compatibility",
            runtimeStarted: false,
          });
          releaseBudgetWithoutRuntime(run.id, "failed");
          return true;
        });
        if (!persisted) return;
        yield { type: "run_failed", error: message, runId: run.id };
        return;
      }
      if (error instanceof RunnerStreamInterruptedError) {
        const requeued = withImmediateTransaction(() => {
          if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
          if (
            runRepository.requeueRunForRunnerReconnect(
              run.id,
              leaseOwner,
              message,
            ) !== 1
          ) {
            return false;
          }
          runRepository.addRunEvent(run.id, "runner_stream_interrupted", {
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
      const persisted = withImmediateTransaction(() => {
        if (!runRepository.ownsRunLease(run.id, leaseOwner)) return false;
        const closedApprovals = approvalRepository.closePending(run.id);
        runRepository.updateRun(run.id, "failed", { error: message });
        runRepository.addRunEvent(run.id, "run_failed", {
          error: message,
          closedApprovals,
        });
        settleBudget(run.id, "failed");
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
  const automation = automationRepository.getAutomation(automationId);
  if (!automation)
    throw new OperationalError("Automation not found", "NOT_FOUND", 404);
  const agent = agentRepository.getAgent(automation.agentId);
  if (!agent) throw new OperationalError("Agent not found", "NOT_FOUND", 404);
  if (!agent.enabled) throw new OperationalError("This agent is disabled.");

  if (scheduledFor) {
    const scheduledForIso = scheduledFor.toISOString();
    const occurrence = automationRepository.claimAutomationOccurrence(
      automation.id,
      scheduledForIso,
    );
    let created = false;
    const run = withImmediateTransaction(() => {
      const existing = runRepository.getRun(occurrence.runId);
      if (existing) return existing;
      const thread = conversationRepository.createThread(
        agent.id,
        automation.name,
      );
      const scheduledRun = createRunExecution({
        runId: occurrence.runId,
        agentId: agent.id,
        threadId: thread.id,
        automationId: automation.id,
        trigger,
        mode: automation.mode,
        prompt: automation.prompt,
      });
      runRepository.addRunEvent(
        scheduledRun.id,
        "automation_occurrence_claimed",
        {
          automationId: automation.id,
          scheduledFor: scheduledForIso,
          missedRunPolicy: automation.missedRunPolicy,
        },
      );
      const marked = automationRepository.markAutomationOccurrenceDispatched(
        automation.id,
        scheduledForIso,
        scheduledRun.id,
      );
      if (marked !== 1) {
        throw new Error("Automation occurrence was already dispatched.");
      }
      automationRepository.updateAutomation(automation.id, {
        lastRunAt: startedAt.toISOString(),
        lastScheduledFor: scheduledForIso,
      });
      created = true;
      return scheduledRun;
    });
    if (created) void executeRunInBackground(run.id);
    return run;
  }

  const thread = conversationRepository.createThread(agent.id, automation.name);
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    automationId: automation.id,
    trigger,
    mode: automation.mode,
    prompt: automation.prompt,
  });
  automationRepository.updateAutomation(automation.id, {
    lastRunAt: startedAt.toISOString(),
  });
  void executeRunInBackground(run.id);
  return run;
}
