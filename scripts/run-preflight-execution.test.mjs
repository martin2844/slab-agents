import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRunContextProfile } from "../lib/run-context-profile.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Work preflight runs after durable lease admission and before Runner", async () => {
  const [source, preflightService, durableQueue] = await Promise.all([
    read("lib/run-service.ts"),
    read("lib/work-run-preflight-service.ts"),
    read("lib/durable-run-queue.ts"),
  ]);
  const dequeue = source.indexOf("lease = await admission.ready");
  const preflight = source.indexOf("await runPreflight(run, agent)");
  const running = source.indexOf('repository.updateRun(run.id, "running")');
  const runner = source.indexOf("await startRunner({");

  assert.ok(dequeue >= 0);
  assert.ok(preflight > dequeue);
  assert.ok(running > preflight);
  assert.ok(runner > running);
  assert.match(
    source.slice(preflight, running),
    /updateRun\(run\.id, "skipped"\)[\s\S]+run_skipped[\s\S]+return/,
  );
  assert.match(preflightService, /"run_preflight_started"/);
  assert.match(preflightService, /"run_preflight_completed"/);
  assert.match(preflightService, /"run_preflight_failed"/);
  assert.match(durableQueue, /lease_expires_at/);
  assert.match(durableQueue, /recoverExpired/);
});

test("a skipped run has no runtime, model, or agent-tool usage", () => {
  const run = {
    id: "run-skipped",
    agentId: "coo",
    threadId: "thread-1",
    automationId: null,
    trigger: "blocked",
    mode: "work_item",
    issueKey: "COO-10",
    runInstructions: "",
    status: "skipped",
    runtime: "codex",
    startedAt: "2026-08-17T19:29:19.000Z",
    completedAt: "2026-08-17T19:29:19.020Z",
    error: null,
    usage: null,
  };
  const events = [
    {
      id: "event-1",
      runId: run.id,
      type: "run_preflight_completed",
      payload: { valid: false, reason: "stale_trigger" },
      createdAt: run.startedAt,
    },
    {
      id: "event-2",
      runId: run.id,
      type: "run_skipped",
      payload: { runtimeStarted: false },
      createdAt: run.completedAt,
    },
  ];

  const profile = buildRunContextProfile(run, events);
  assert.equal(profile.modelCalls.length, 0);
  assert.equal(profile.toolCalls.length, 0);
  assert.equal(profile.cumulativeInputTokens, 0);
  assert.equal(profile.mcpResponseApproxTokens, 0);
});

test("Work UI sends the read version and handles a conflict without overwriting", async () => {
  const [route, board, client] = await Promise.all([
    read("app/api/work/issues/[key]/route.ts"),
    read("components/work-board.tsx"),
    read("lib/client-api.ts"),
  ]);

  assert.match(route, /expected_version: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(board, /expected_version: detail\.issue\.version/);
  assert.match(board, /expected_version: currentIssue\.version/);
  assert.match(board, /e\.code === "VERSION_CONFLICT"/);
  assert.match(board, /Latest state loaded/);
  assert.match(client, /class ApiClientError/);
});
