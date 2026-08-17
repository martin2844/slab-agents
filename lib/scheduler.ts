import "server-only";

import { CronExpressionParser } from "cron-parser";
import { repository } from "@/lib/repository";
import { startAutomationRun } from "@/lib/run-service";

const state = globalThis as unknown as {
  slabScheduler?: NodeJS.Timeout;
  slabSchedulerBusy?: boolean;
  slabSchedulerTick?: () => Promise<void>;
};

function due(cronExpression: string, lastRunAt: string | null, current: Date) {
  const windowStart = new Date(current.getTime() - 65_000);
  const previous = CronExpressionParser.parse(cronExpression, {
    currentDate: current,
  })
    .prev()
    .toDate();
  return (
    previous >= windowStart && (!lastRunAt || new Date(lastRunAt) < previous)
  );
}

export async function tickScheduler() {
  if (state.slabSchedulerBusy) return;
  state.slabSchedulerBusy = true;
  try {
    const current = new Date();
    for (const automation of repository.listAutomations()) {
      if (!automation.enabled || !automation.cronExpression) continue;
      try {
        if (!due(automation.cronExpression, automation.lastRunAt, current))
          continue;
        startAutomationRun(automation.id, "automation", current);
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
