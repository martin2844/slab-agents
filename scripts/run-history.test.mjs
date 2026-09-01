import assert from "node:assert/strict";
import test from "node:test";

import { groupRunHistory } from "../lib/run-history.ts";

function run(id, overrides = {}) {
  return {
    id,
    agentId: "agent-1",
    threadId: null,
    automationId: null,
    trigger: "manual",
    mode: "task",
    issueKey: null,
    runInstructions: "",
    status: "completed",
    runtime: "codex",
    model: "default",
    startedAt: "2026-09-01T10:00:00.000Z",
    completedAt: "2026-09-01T10:01:00.000Z",
    error: null,
    usage: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    queuedAt: "2026-09-01T10:00:00.000Z",
    attemptCount: 1,
    runnerRunId: id,
    runnerEventId: 1,
    ...overrides,
  };
}

test("chat executions group by product thread without hiding non-chat runs", () => {
  const history = groupRunHistory([
    run("chat-new", {
      threadId: "thread-1",
      trigger: "chat",
      mode: "chat",
    }),
    run("task"),
    run("chat-old", {
      threadId: "thread-1",
      trigger: "chat",
      mode: "chat",
    }),
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].kind, "conversation");
  assert.deepEqual(
    history[0].runs.map(({ id }) => id),
    ["chat-new", "chat-old"],
  );
  assert.equal(history[1].kind, "run");
  assert.equal(history[1].run.id, "task");
});

test("a conversation surfaces an active child while preserving every run", () => {
  const history = groupRunHistory([
    run("completed", {
      threadId: "thread-1",
      trigger: "chat",
      mode: "chat",
    }),
    run("waiting", {
      threadId: "thread-1",
      trigger: "chat",
      mode: "chat",
      status: "waiting_approval",
      completedAt: null,
    }),
  ]);

  assert.equal(history[0].kind, "conversation");
  assert.equal(history[0].status, "waiting_approval");
  assert.equal(history[0].runs.length, 2);
});

test("chat runs without a product thread remain individually auditable", () => {
  const history = groupRunHistory([
    run("legacy-chat", { trigger: "chat", mode: "chat" }),
  ]);

  assert.equal(history[0].kind, "run");
  assert.equal(history[0].run.id, "legacy-chat");
});
