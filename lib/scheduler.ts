import "server-only";

import { automationRepository } from "@/lib/repositories/automation-repository";

import { startAutomationRun } from "@/lib/run-service";
import { dueAutomation } from "@/lib/automation-schedule";
import { tickEmailAutomations } from "@/lib/email-automation-dispatcher";
import { tickSystemUpdates } from "@/lib/system-update-service";
import { tickKnowledgeSources } from "@/lib/sources/scheduler";

const state = globalThis as unknown as {
  slabScheduler?: NodeJS.Timeout;
  slabSchedulerBusy?: boolean;
  slabSchedulerTick?: () => Promise<void>;
};

export async function tickScheduler() {
  if (state.slabSchedulerBusy) return;
  state.slabSchedulerBusy = true;
  try {
    void tickEmailAutomations().catch((error) => {
      console.error("[scheduler] Email automation tick:", error);
    });
    void tickSystemUpdates().catch((error) => {
      console.error("[scheduler] System update tick:", error);
    });
    void tickKnowledgeSources().catch((error) => {
      console.error("[scheduler] Knowledge source tick:", error);
    });
    const current = new Date();
    for (const occurrence of automationRepository.listPendingAutomationOccurrences()) {
      try {
        startAutomationRun(
          occurrence.automationId,
          "automation",
          current,
          new Date(occurrence.scheduledFor),
        );
      } catch (error) {
        console.error(
          `[scheduler] pending ${occurrence.automationId} at ${occurrence.scheduledFor}:`,
          error,
        );
      }
    }
    for (const automation of automationRepository.listAutomations()) {
      if (!automation.enabled || !automation.cronExpression) continue;
      try {
        const occurrence = dueAutomation(automation, current);
        if (!occurrence) continue;
        startAutomationRun(automation.id, "automation", current, occurrence);
      } catch (error) {
        console.error(`[scheduler] ${automation.name}:`, error);
      }
    }
  } finally {
    state.slabSchedulerBusy = false;
  }
}

state.slabSchedulerTick = tickScheduler;

export function startScheduler() {
  state.slabSchedulerTick = tickScheduler;
  if (state.slabScheduler) return;
  void state.slabSchedulerTick();
  state.slabScheduler = setInterval(
    () => void state.slabSchedulerTick?.(),
    30_000,
  );
  state.slabScheduler.unref();
}
