import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeAgentOverview,
  summarizeWorkOverview,
} from "../lib/overview-summary.ts";

function issue(key, status, assignee = null) {
  return {
    id: key,
    key,
    title: key,
    status,
    priority: "medium",
    type: "task",
    assignee,
    version: 1,
  };
}

test("work overview assigns every open issue to one pipeline stage", () => {
  const issues = [
    issue("OPS-1", "new"),
    issue("OPS-2", "new", "sales"),
    issue("OPS-3", "in_progress", "coo"),
    issue("OPS-4", "review", "coo"),
    issue("OPS-5", "blocked", "sales"),
    issue("OPS-6", "in_progress", "sales"),
    issue("OPS-7", "done", "sales"),
  ];

  const summary = summarizeWorkOverview(issues, [{ key: "OPS-6" }]);

  assert.deepEqual(summary, {
    open: 6,
    backlog: 1,
    assigned: 1,
    inProgress: 1,
    blocked: 2,
    review: 1,
    connected: true,
  });
  assert.equal(
    summary.backlog +
      summary.assigned +
      summary.inProgress +
      summary.review +
      summary.blocked,
    summary.open,
  );
});

test("resolved relationship-blocked issues do not inflate the active pipeline", () => {
  const summary = summarizeWorkOverview(
    [issue("OPS-1", "done")],
    [{ key: "OPS-1" }],
  );

  assert.equal(summary.open, 0);
  assert.equal(summary.blocked, 0);
});

test("queued and approval-waiting agents are engaged rather than idle", () => {
  const agents = [
    { id: "coo", enabled: true },
    { id: "sales", enabled: true },
    { id: "disabled", enabled: false },
  ];
  const runs = [
    { agentId: "coo", status: "waiting_approval" },
    { agentId: "sales", status: "queued" },
  ];

  assert.deepEqual(summarizeAgentOverview(agents, runs), {
    total: 3,
    running: 0,
    queued: 1,
    waitingApproval: 1,
    idle: 0,
  });
});
