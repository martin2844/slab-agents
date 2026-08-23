import "server-only";

import { durableRunQueue } from "@/lib/durable-run-state";
import { repository } from "@/lib/repository";
import { executeRunInBackground } from "@/lib/run-service";

const state = globalThis as unknown as {
  slabRunDispatcher?: NodeJS.Timeout;
  slabRunDispatcherBusy?: boolean;
};

export function recoverRunDispatch() {
  const recovery = durableRunQueue.recoverExpired();
  for (const runId of recovery.requeued) {
    const run = repository.getRun(runId);
    repository.addRunEvent(runId, "run_recovered", {
      action: "requeued",
      previousStatus: "running_or_waiting_approval",
      attemptCount: run?.attemptCount ?? null,
      runtimeThreadPolicy:
        run?.mode === "chat" ? "chat_may_resume" : "non_chat_fresh",
    });
  }
  for (const runId of recovery.failed) {
    const closedApprovals = repository.closePendingApprovals(runId);
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
  repository.setSetting("system_maintenance_mode", enabled ? "on" : "off");
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
