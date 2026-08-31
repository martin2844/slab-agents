import { CronExpressionParser } from "cron-parser";

import type { Automation } from "@/lib/types";

export function scheduledOccurrence(
  cronExpression: string,
  current: Date,
  timezone = "UTC",
) {
  return CronExpressionParser.parse(cronExpression, {
    currentDate: current,
    tz: timezone,
  })
    .prev()
    .toDate();
}

export function nextScheduledOccurrence(
  cronExpression: string,
  current: Date,
  timezone = "UTC",
) {
  return CronExpressionParser.parse(cronExpression, {
    currentDate: current,
    tz: timezone,
  })
    .next()
    .toDate();
}

export function dueAutomation(
  automation: Pick<
    Automation,
    | "cronExpression"
    | "createdAt"
    | "lastScheduledFor"
    | "missedRunPolicy"
    | "scheduleTimezone"
  >,
  current: Date,
) {
  if (!automation.cronExpression) return null;
  const previous = scheduledOccurrence(
    automation.cronExpression,
    current,
    automation.scheduleTimezone,
  );
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

export function nextScheduledOccurrences(
  cronExpression: string,
  current: Date,
  timezone = "UTC",
  count = 3,
) {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: current,
    tz: timezone,
  });
  return Array.from({ length: count }, () => interval.next().toDate());
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
