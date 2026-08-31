import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-005 — automation cards showed a last-run timestamp with no result link
// Found by /qa on 2026-08-17
// Report: .gstack/qa-reports/qa-report-localhost-3009-2026-08-17.md
test("automation last-run timestamps link to the actual latest run", async () => {
  const [component, repository, types] = await Promise.all([
    readFile(
      new URL("../components/automations-view.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/repositories/automation-repository.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(types, /lastRunId: string \| null/);
  assert.match(repository, /last_run_id/);
  assert.match(component, /href=\{`\/runs\/\$\{automation\.lastRunId\}`\}/);
  assert.match(
    component,
    /setAutomations\(activity\.automations\)/,
    "The operational poll must refresh the latest run linkage returned by the repository",
  );
});
