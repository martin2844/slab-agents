import assert from "node:assert/strict";
import test from "node:test";
import { buildRunProgress } from "../lib/run-progress.ts";

function event(type, payload = {}, id = crypto.randomUUID()) {
  return {
    id,
    runId: "run-1",
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
}

test("run progress turns Work tool events into user-facing activity", () => {
  const progress = buildRunProgress(
    [
      event("run_started"),
      event("tool_started", {
        toolId: "tool-1",
        name: "work.list_issues",
        server: "work",
        status: "inProgress",
      }),
    ],
    "running",
  );

  assert.equal(progress.headline, "Reviewing open work");
  assert.deepEqual(progress.items, [
    {
      id: "tool-1",
      label: "Reviewing open work",
      command: "mcp work.list_issues",
      status: "active",
    },
  ]);
  assert.equal(progress.command, "mcp work.list_issues");
});

test("run progress preserves completed activity across page reloads", () => {
  const progress = buildRunProgress(
    [
      event("tool_started", { toolId: "tool-1", name: "docs.search_docs" }),
      event("tool_completed", {
        toolId: "tool-1",
        name: "docs.search_docs",
        status: "completed",
      }),
    ],
    "running",
  );

  assert.equal(progress.headline, "Analyzing what it found");
  assert.deepEqual(progress.items, [
    {
      id: "tool-1",
      label: "Searched company docs",
      command: "mcp docs.search_docs",
      status: "done",
    },
  ]);
});

test("run progress makes a real approval pause explicit", () => {
  const progress = buildRunProgress([], "waiting_approval");
  assert.equal(progress.headline, "Waiting for your approval");
});
