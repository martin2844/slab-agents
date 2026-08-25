import "server-only";

import { durableRunQueue } from "@/lib/durable-run-state";
import { repository } from "@/lib/repository";
import { settingsStore } from "@/lib/repositories/settings-store";
import { approvalStore } from "@/lib/repositories/approval-store";
import { executeRunInBackground } from "@/lib/run-service";

const state = globalThis as unknown as {
  slabRunDispatcher?: NodeJS.Timeout;
  slabRunDispatcherBusy?: boolean;
};

export function recoverRunDispatch(
  queue: Pick<typeof durableRunQueue, "recoverExpired"> = durableRunQueue,
) {
  return repository.transaction(() => {
    const recovery = queue.recoverExpired();
    for (const runId of recovery.requeued) {
      const run = repository.getRun(runId);
      const resolvingApprovals = approvalStore
        .listForRun(runId)
        .filter((approval) => approval.status === "resolving");
      const ambiguous = resolvingApprovals.filter(
        (approval) =>
          approval.details.runnerDecision !== "approve" &&
          approval.details.runnerDecision !== "deny",
      );
      if (ambiguous.length > 0) {
        repository.updateRun(runId, "failed", {
          error:
            "Approval resolution was interrupted with unknown Runner state; the run was stopped to avoid sending a duplicate decision.",
        });
        const closedApprovals = approvalStore.closeOpen(runId);
        repository.addRunEvent(runId, "run_recovery_failed", {
          action: "failed",
          reason: "ambiguous_approval_resolution",
          closedApprovals,
          approvalIds: ambiguous.map((approval) => approval.id),
        });
        continue;
      }
      for (const approval of resolvingApprovals) {
        const decision = approval.details.runnerDecision;
        const resolved = approvalStore.resolve(
          approval.id,
          decision === "approve" ? "approved" : "denied",
        );
        if (resolved) {
          repository.addRunEvent(runId, "approval_recovered", {
            approvalId: approval.id,
            decision,
            reason: "runner_decision_already_recorded",
          });
        }
      }
      repository.addRunEvent(runId, "run_recovered", {
        action: "requeued",
        previousStatus: "running_or_waiting_approval",
        attemptCount: run?.attemptCount ?? null,
        runtimeThreadPolicy:
          run?.mode === "chat" ? "chat_may_resume" : "non_chat_fresh",
      });
    }
    for (const runId of recovery.failed) {
      const closedApprovals = approvalStore.closeOpen(runId);
      repository.addRunEvent(runId, "run_recovery_failed", {
        action: "failed",
        reason: "abandoned_runtime_or_approval",
        closedApprovals,
      });
    }
    for (const runId of recovery.releasedQueued) {
      repository.addRunEvent(runId, "run_lease_recovered", {
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
    for (const runId of durableRunQueue.listQueuedRunIds()) {
      void executeRunInBackground(runId);
    }
  } finally {
    state.slabRunDispatcherBusy = false;
  }
}

export function setSystemMaintenance(enabled: boolean) {
  settingsStore.set("system_maintenance_mode", enabled ? "on" : "off");
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
