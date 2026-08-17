import "server-only";

import { CronExpressionParser } from "cron-parser";
import { repository } from "@/lib/repository";
import { executeAutomationRun } from "@/lib/run-service";

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
        const agent = repository.getAgent(automation.agentId);
        if (!agent?.enabled) continue;
        const thread = repository.createThread(agent.id, automation.name);
        const run = repository.createRun({
          agentId: agent.id,
          threadId: thread.id,
          automationId: automation.id,
          runtime: agent.runtime,
        });
        repository.addMessage(thread.id, run.id, "user", automation.prompt);
        repository.updateAutomation(automation.id, {
          lastRunAt: current.toISOString(),
        });
        void executeAutomationRun(run.id, automation.prompt);
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
