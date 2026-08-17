import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-004 — missing Runner runs left approvals pending forever
// Found by /qa on 2026-08-17
// Report: .gstack/qa-reports/qa-report-localhost-3009-2026-08-17.md
test("a missing Runner run dismisses its stale local approval", async () => {
  const [route, runnerErrors] = await Promise.all([
    readFile(
      new URL("../app/api/approvals/[id]/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/runner-errors.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    runnerErrors,
    /status === 404[\s\S]*message === "Run was not found"/,
    "the terminal stale-run condition must be identified narrowly",
  );
  assert.match(
    route,
    /isRunnerRunNotFound\(error\)[\s\S]*resolveApproval\([\s\S]*"denied"[\s\S]*updateRun\([\s\S]*"cancelled"[\s\S]*dismissed: true/,
    "the stale approval and its orphaned local run must be closed instead of released back to pending",
  );
});
