import "server-only";
import { reconcileDocsRunAccess } from "@/lib/docs-run-changes";
import { tickWhatsAppAutomations } from "@/lib/whatsapp-automation-service";

import { automationRepository } from "@/lib/repositories/automation-repository";

import { startAutomationRun } from "@/lib/run-service";
import { dueAutomation } from "@/lib/automation-schedule";
import { tickEmailAutomations } from "@/lib/email-automation-dispatcher";
import { tickSystemUpdates } from "@/lib/system-update-service";
import { tickKnowledgeSources } from "@/lib/sources/scheduler";
import { tickOperatorNotifications } from "@/lib/operator-notification-service";
import { allows } from "@/lib/autonomy/service";
import { tickAutonomy } from "@/lib/autonomy/loops";

const state = globalThis as unknown as {
  slabScheduler?: NodeJS.Timeout;
  slabSchedulerBusy?: boolean;
  slabSchedulerTick?: () => Promise<void>;
  slabWhatsAppTimer?: NodeJS.Timeout;
  slabWhatsAppTick?: () => Promise<unknown>;
};

export async function tickScheduler() {
  if (state.slabSchedulerBusy) return;
  state.slabSchedulerBusy = true;
  try {
    void reconcileDocsRunAccess().catch(() =>
      console.error("[scheduler] Docs access reconciliation failed."),
    );
    // Autonomy level 0 (or triggers off) stops everything that starts on its own.
    const triggers = allows("triggers");
    if (triggers) {
      void tickEmailAutomations().catch((error) => {
        console.error("[scheduler] Email automation tick:", error);
      });
    }
    void tickAutonomy().catch((error) => {
      console.error("[scheduler] Autonomy tick:", error);
    });
    void tickSystemUpdates().catch((error) => {
      console.error("[scheduler] System update tick:", error);
    });
    void tickKnowledgeSources().catch((error) => {
      console.error("[scheduler] Knowledge source tick:", error);
    });
    void tickOperatorNotifications().catch((error) => {
      console.error("[scheduler] Operator notification tick:", error);
    });
    if (!triggers) return;
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
  state.slabWhatsAppTick = tickWhatsAppAutomations;
  if (!state.slabWhatsAppTimer) {
    state.slabWhatsAppTimer = setInterval(() => {
      if (!allows("triggers")) return;
      void state
        .slabWhatsAppTick?.()
        .catch(() =>
          console.error("[scheduler] WhatsApp automation tick failed."),
        );
    }, 1000);
    state.slabWhatsAppTimer.unref();
  }
  state.slabSchedulerTick = tickScheduler;
  if (state.slabScheduler) return;
  void state.slabSchedulerTick();
  state.slabScheduler = setInterval(
    () => void state.slabSchedulerTick?.(),
    30_000,
  );
  state.slabScheduler.unref();
}
