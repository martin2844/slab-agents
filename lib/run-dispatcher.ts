import "server-only";
import { allows, autonomyLimits, activeRunCount } from "@/lib/autonomy/service";
import { autonomyRepository } from "@/lib/repositories/autonomy-repository";

import { runRepository } from "@/lib/repositories/run-repository";
import { withImmediateTransaction } from "@/lib/db/transaction";

import { durableRunQueue } from "@/lib/repositories/durable-run-queue-repository";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { executeRunInBackground } from "@/lib/run-service";

const state = globalThis as unknown as {
  slabRunDispatcher?: NodeJS.Timeout;
  slabRunDispatcherBusy?: boolean;
};

export function recoverRunDispatch(
  queue: Pick<typeof durableRunQueue, "recoverExpired"> = durableRunQueue,
) {
  return withImmediateTransaction(() => {
    const recovery = queue.recoverExpired();
    for (const runId of recovery.requeued) {
      const run = runRepository.getRun(runId);
      const resolvingApprovals = approvalRepository
        .listForRun(runId)
        .filter((approval) => approval.status === "resolving");
      const ambiguous = resolvingApprovals.filter(
        (approval) =>
          approval.details.runnerDecision !== "approve" &&
          approval.details.runnerDecision !== "deny",
      );
      if (ambiguous.length > 0) {
        runRepository.updateRun(runId, "failed", {
          error:
            "Approval resolution was interrupted with unknown Runner state; the run was stopped to avoid sending a duplicate decision.",
        });
        const closedApprovals = approvalRepository.closeOpen(runId);
        runRepository.addRunEvent(runId, "run_recovery_failed", {
          action: "failed",
          reason: "ambiguous_approval_resolution",
          closedApprovals,
          approvalIds: ambiguous.map((approval) => approval.id),
        });
        continue;
      }
      for (const approval of resolvingApprovals) {
        const decision = approval.details.runnerDecision;
        const resolved = approvalRepository.resolve(
          approval.id,
          decision === "approve" ? "approved" : "denied",
        );
        if (resolved) {
          runRepository.addRunEvent(runId, "approval_recovered", {
            approvalId: approval.id,
            decision,
            reason: "runner_decision_already_recorded",
          });
        }
      }
      runRepository.addRunEvent(runId, "run_recovered", {
        action: "requeued",
        previousStatus: "running_or_waiting_approval",
        attemptCount: run?.attemptCount ?? null,
        runtimeThreadPolicy:
          run?.mode === "chat" ? "chat_may_resume" : "non_chat_fresh",
      });
    }
    for (const runId of recovery.failed) {
      const closedApprovals = approvalRepository.closeOpen(runId);
      runRepository.addRunEvent(runId, "run_recovery_failed", {
        action: "failed",
        reason: "abandoned_runtime_or_approval",
        closedApprovals,
      });
    }
    for (const runId of recovery.releasedQueued) {
      runRepository.addRunEvent(runId, "run_lease_recovered", {
        action: "released_expired_queue_lease",
      });
    }
    return recovery;
  });
}

export async function tickRunDispatcher() {
  if (state.slabRunDispatcherBusy) return;
  state.slabRunDispatcherBusy = true;
  try {
    recoverRunDispatch();
    if (durableRunQueue.maintenanceEnabled()) return;
    let queued = durableRunQueue.listQueuedRunIds();
    // Paused (level 0): runs that autonomy started on its own wait for the resume.
    if (!allows("triggers")) {
      const held = autonomyRepository.selfStartedRunIds(queued);
      queued = queued.filter((runId) => !held.has(runId));
    }
    // Autonomy guard: at most maxConcurrentRuns runs at a time (off at level 1). Runs
    // waiting behind another run of the same agent cannot start, so they take no slot.
    if (allows("guards")) {
      let free = Math.max(0, autonomyLimits().maxConcurrentRuns - activeRunCount());
      const busy = autonomyRepository.busyAgentIds();
      const picked: string[] = [];
      for (const runId of queued) {
        if (free <= 0) break;
        const run = runRepository.getRun(runId);
        if (!run) continue;
        // WhatsApp chats and coding stages run in parallel with the agent's other runs.
        const independent = run.trigger === "whatsapp" || run.trigger === "coding";
        if (!independent && busy.has(run.agentId)) continue;
        if (!independent) busy.add(run.agentId);
        picked.push(runId);
        free -= 1;
      }
      queued = picked;
    }
    for (const runId of queued) {
      void executeRunInBackground(runId);
    }
  } finally {
    state.slabRunDispatcherBusy = false;
  }
}

export function setSystemMaintenance(enabled: boolean) {
  settingsRepository.set("system_maintenance_mode", enabled ? "on" : "off");
}

export function startRunDispatcher() {
  if (state.slabRunDispatcher) return;
  recoverRunDispatch();
  void tickRunDispatcher();
  state.slabRunDispatcher = setInterval(() => {
    void tickRunDispatcher();
  }, 1_000);
  state.slabRunDispatcher.unref();
}
