import { CronExpressionParser } from "cron-parser";

import type { Automation } from "@/lib/types";

export function scheduledOccurrence(
  cronExpression: string,
  current: Date,
) {
  return CronExpressionParser.parse(cronExpression, {
    currentDate: current,
  })
    .prev()
    .toDate();
}

export function dueAutomation(
  automation: Pick<
    Automation,
    | "cronExpression"
    | "createdAt"
    | "lastScheduledFor"
    | "missedRunPolicy"
  >,
  current: Date,
) {
  if (!automation.cronExpression) return null;
  const previous = scheduledOccurrence(automation.cronExpression, current);
  const baseline = new Date(
    automation.lastScheduledFor ?? automation.createdAt,
  );
  if (previous <= baseline) return null;
  if (automation.missedRunPolicy === "skip") {
    const windowStart = new Date(current.getTime() - 65_000);
    if (previous < windowStart) return null;
  }
  return previous;
}
