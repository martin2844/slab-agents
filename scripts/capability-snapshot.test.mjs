import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("capabilities are snapshotted once per run and approvals do not dispatch runs", async () => {
  const [runner, service, approval, coordination, readme] = await Promise.all([
    read("lib/runner.ts"),
    read("lib/run-service.ts"),
    read("app/api/approvals/[id]/route.ts"),
    read("lib/work-coordination.ts"),
    read("README.md"),
  ]);

  assert.match(runner, /semantics: "snapshot_at_run_start"/);
  assert.match(runner, /changesApplyTo: "next_run"/);
  assert.match(service, /"run_capability_snapshot"/);
  assert.doesNotMatch(approval, /createRunExecution|executeRunInBackground/);
  assert.match(approval, /resolveRunnerApproval/);
  assert.match(coordination, /"work_coordination_triggered"/);
  assert.match(readme, /does not\s+hot-plug a new server and does not create a new run/);
});
