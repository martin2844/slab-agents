import assert from "node:assert/strict";
import test from "node:test";

import { defineRunExecution, planRuntimeThread } from "../lib/run-execution.ts";

test("only chat can resume a persisted runtime thread", () => {
  assert.deepEqual(planRuntimeThread("chat", "runtime-chat"), {
    runtimeThreadId: "runtime-chat",
    continuity: "resumed",
    reusable: true,
  });
  assert.deepEqual(planRuntimeThread("chat", null), {
    runtimeThreadId: null,
    continuity: "fresh",
    reusable: true,
  });
  for (const mode of ["task", "review", "assignment", "work_item"]) {
    assert.deepEqual(planRuntimeThread(mode, "legacy-runtime"), {
      runtimeThreadId: null,
      continuity: "fresh",
      reusable: false,
    });
  }
});

test("chat execution is conversation-scoped and issue-free", () => {
  const execution = defineRunExecution({ trigger: "chat", mode: "chat" });

  assert.equal(execution.issueKey, null);
  assert.match(execution.policy, /conversation/i);
  assert.doesNotMatch(execution.policy, /assigned work item/i);
});

test("assignment execution requires an issue and stays issue-scoped", () => {
  const execution = defineRunExecution({
    trigger: "assignment",
    mode: "assignment",
    issueKey: "COO-42",
  });

  assert.equal(execution.issueKey, "COO-42");
  assert.match(execution.policy, /assigned work item/i);
  assert.match(execution.policy, /COO-42/);
  assert.match(execution.policy, /general operational review/i);
  assert.match(execution.policy, /requested deliverable/i);
  assert.match(execution.policy, /downstream action/i);
  assert.match(execution.policy, /Use done when.*verifiably complete/i);
  assert.match(execution.policy, /Use review only when.*approval/i);
  assert.match(execution.policy, /do not use review merely.*next step/i);
  assert.match(execution.policy, /Use blocked only when.*cannot be produced/i);
});

test("manual and scheduled reviews share policy but preserve their trigger", () => {
  const manual = defineRunExecution({ trigger: "manual", mode: "review" });
  const scheduled = defineRunExecution({
    trigger: "automation",
    mode: "review",
  });

  assert.equal(manual.issueKey, null);
  assert.equal(scheduled.issueKey, null);
  assert.equal(manual.policy, scheduled.policy);
  assert.notEqual(manual.trigger, scheduled.trigger);
  assert.match(manual.policy, /operational review/i);
  assert.match(manual.policy, /no associated work item/i);
});

test("execution invariants reject leaked or missing issue scope", () => {
  assert.throws(
    () =>
      defineRunExecution({
        trigger: "manual",
        mode: "review",
        issueKey: "COO-1",
      }),
    /cannot have an associated issue/i,
  );
  assert.throws(
    () => defineRunExecution({ trigger: "assignment", mode: "assignment" }),
    /requires an associated issue/i,
  );
});

test("work-item review requests remain distinct from company reviews", () => {
  const execution = defineRunExecution({
    trigger: "review_requested",
    mode: "work_item",
    issueKey: "COO-42",
  });

  assert.equal(execution.issueKey, "COO-42");
  assert.match(execution.policy, /associated work item/i);
  assert.doesNotMatch(execution.policy, /^Perform an operational review/m);
  assert.match(execution.policy, /requested deliverable/i);
});
