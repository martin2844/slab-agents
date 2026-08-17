import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWorkRunPreflight,
  requiresWorkRunPreflight,
} from "../lib/work-run-preflight.ts";

const agent = { id: "agent-sales", name: "Sales", slug: "sales" };

function issue(overrides = {}) {
  return {
    id: "issue-1",
    key: "COO-10",
    title: "Check PostHog for actionable sales items",
    status: "in_progress",
    priority: "medium",
    type: "task",
    assignee: "sales",
    labels: [],
    version: 9,
    ...overrides,
  };
}

test("a queued blocked run is stale after the issue is resolved", () => {
  const result = evaluateWorkRunPreflight({
    trigger: "blocked",
    targetAgent: agent,
    issue: issue({ status: "done", assignee: "sales" }),
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "stale_trigger");
  assert.deepEqual(result.expected, { blocked: true });
  assert.deepEqual(result.observed, {
    exists: true,
    status: "done",
    blocked: false,
    assignee: "sales",
    version: 9,
  });
});

test("a blocked run remains valid while semantic blocked state is current", () => {
  const result = evaluateWorkRunPreflight({
    trigger: "blocked",
    targetAgent: { id: "agent-coo", name: "COO", slug: "coo" },
    issue: issue({ status: "blocked", labels: ["status:blocked"] }),
  });

  assert.equal(result.valid, true);
});

test("an assignment run is stale after reassignment", () => {
  const result = evaluateWorkRunPreflight({
    trigger: "assignment",
    targetAgent: agent,
    issue: issue({ key: "COO-20", assignee: "coo" }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.expected, {
    assignee: "sales",
    actionableStatus: true,
  });
});

test("an assignment run remains valid for the same enabled assignee", () => {
  const result = evaluateWorkRunPreflight({
    trigger: "assignment",
    targetAgent: agent,
    issue: issue({ key: "COO-21", status: "new" }),
  });

  assert.equal(result.valid, true);
});

test("mentions remain event-based while reviews bypass Work preflight", () => {
  assert.equal(requiresWorkRunPreflight("mention"), true);
  assert.equal(
    evaluateWorkRunPreflight({
      trigger: "mention",
      targetAgent: agent,
      issue: issue({ status: "done", assignee: null }),
    }).valid,
    true,
  );
  assert.equal(requiresWorkRunPreflight("manual"), false);
  assert.equal(requiresWorkRunPreflight("automation"), false);
  assert.equal(requiresWorkRunPreflight("chat"), false);
});

test("resumed and review-requested reuse the state predicates that create them", () => {
  assert.equal(
    evaluateWorkRunPreflight({
      trigger: "resumed",
      targetAgent: agent,
      issue: issue({ status: "in_progress", assignee: "sales" }),
    }).valid,
    true,
  );
  assert.equal(
    evaluateWorkRunPreflight({
      trigger: "resumed",
      targetAgent: agent,
      issue: issue({ status: "review", assignee: "sales" }),
    }).valid,
    false,
  );
  assert.equal(
    evaluateWorkRunPreflight({
      trigger: "review_requested",
      targetAgent: { id: "agent-coo", name: "COO", slug: "coo" },
      issue: issue({ status: "review", assignee: "sales" }),
    }).valid,
    true,
  );
  assert.equal(
    evaluateWorkRunPreflight({
      trigger: "review_requested",
      targetAgent: { id: "agent-coo", name: "COO", slug: "coo" },
      issue: issue({ status: "done", assignee: "sales" }),
    }).valid,
    false,
  );
});

test("a deleted Work item invalidates every Work-triggered run", () => {
  for (const trigger of [
    "assignment",
    "resumed",
    "review_requested",
    "blocked",
    "mention",
  ]) {
    assert.equal(
      evaluateWorkRunPreflight({ trigger, targetAgent: agent, issue: null })
        .valid,
      false,
    );
  }
});
