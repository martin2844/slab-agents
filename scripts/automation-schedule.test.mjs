import assert from "node:assert/strict";
import test from "node:test";

import {
  dueAutomation,
  nextScheduledOccurrence,
} from "../lib/automation-schedule.ts";

process.env.TZ = "UTC";

function automation(overrides = {}) {
  return {
    cronExpression: "0 8 * * *",
    createdAt: "2026-08-20T09:00:00.000Z",
    lastScheduledFor: null,
    missedRunPolicy: "latest_once",
    scheduleTimezone: "UTC",
    ...overrides,
  };
}

test("latest_once catches up only the most recent missed occurrence", () => {
  const due = dueAutomation(automation(), new Date("2026-08-23T12:00:00.000Z"));
  assert.equal(due?.toISOString(), "2026-08-23T08:00:00.000Z");
});

test("a persisted occurrence is never dispatched twice", () => {
  const due = dueAutomation(
    automation({ lastScheduledFor: "2026-08-23T08:00:00.000Z" }),
    new Date("2026-08-23T12:00:00.000Z"),
  );
  assert.equal(due, null);
});

test("skip ignores an old missed occurrence and waits for a current window", () => {
  const skipped = dueAutomation(
    automation({ missedRunPolicy: "skip" }),
    new Date("2026-08-23T12:00:00.000Z"),
  );
  assert.equal(skipped, null);

  const current = dueAutomation(
    automation({ missedRunPolicy: "skip" }),
    new Date("2026-08-24T08:00:30.000Z"),
  );
  assert.equal(current?.toISOString(), "2026-08-24T08:00:00.000Z");
});

test("nextScheduledOccurrence returns the next future schedule", () => {
  const next = nextScheduledOccurrence(
    "0 8 * * *",
    new Date("2026-08-23T12:00:00.000Z"),
  );
  assert.equal(next.toISOString(), "2026-08-24T08:00:00.000Z");
});

test("schedule evaluation respects the configured IANA timezone", () => {
  const next = nextScheduledOccurrence(
    "0 9 * * *",
    new Date("2026-08-23T12:30:00.000Z"),
    "America/Argentina/Buenos_Aires",
  );
  assert.equal(next.toISOString(), "2026-08-24T12:00:00.000Z");
});
