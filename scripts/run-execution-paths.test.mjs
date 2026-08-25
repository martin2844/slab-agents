import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every entry point uses the same persisted execution contract", async () => {
  const [
    service,
    chat,
    operatingLoop,
    coordination,
    runner,
    scheduler,
    automationRun,
  ] = await Promise.all([
    read("lib/run-service.ts"),
    read("app/api/chat/route.ts"),
    read("app/api/operating-loop/route.ts"),
    read("lib/work-coordination.ts"),
    read("lib/runner.ts"),
    read("lib/scheduler.ts"),
    read("app/api/automations/[id]/run/route.ts"),
  ]);

  assert.match(service, /runner\.contextProfile\.then/);
  assert.match(service, /event\.type === "context\.bootstrap"/);
  assert.match(service, /getRunInput\(run\.id\)/);
  assert.match(service, /trigger: execution\.trigger/);
  assert.match(service, /mode: execution\.mode/);
  assert.match(service, /issueKey: execution\.issueKey/);
  assert.match(chat, /createRunExecution\(\{/);
  assert.match(chat, /trigger: "chat"/);
  assert.match(chat, /mode: "chat"/);
  assert.match(operatingLoop, /trigger: "manual"/);
  assert.match(operatingLoop, /mode: input\.mode/);
  assert.match(coordination, /createRunExecution\(\{/);
  assert.match(coordination, /issueKey: input\.issue\.key/);
  assert.match(coordination, /eventInstructions: coordinationInstructions/);
  assert.match(
    scheduler,
    /startAutomationRun\(\s*automation\.id,\s*"automation",\s*current,\s*occurrence,?\s*\)/,
  );
  assert.match(automationRun, /startAutomationRun\(id, "manual"\)/);
  for (const key of [
    "agent_instructions",
    "work_coordination_instructions",
    "run_policy",
    "execution_metadata",
    "integration_instructions",
    "initial_user_input",
    "mcp_server_configuration",
  ]) {
    assert.match(runner, new RegExp(`key: "${key}"`));
  }
  assert.match(runner, /inspectMcpDefinitions/);
  assert.match(service, /planRuntimeThread\(/);
  assert.match(service, /if \(runtimeThreadPlan\.reusable\)/);
  assert.match(runner, /input\.execution\.mode === "chat"/);
  assert.match(runner, /shouldRehydrateConversation/);
});

test("execution semantics are persisted and historical runs are backfilled", async () => {
  const [migration, runRepository, types] = await Promise.all([
    read("db/migrations/202608170006_run_execution_semantics.cjs"),
    read("lib/repositories/run-repository.ts"),
    read("lib/types.ts"),
  ]);

  for (const column of ["trigger", "mode", "issue_key", "run_instructions"]) {
    assert.match(migration, new RegExp(`"${column}"`));
  }
  assert.match(migration, /work_coordination_events/);
  assert.match(migration, /WHEN 'operating_loop' THEN 'manual'/);
  assert.match(runRepository, /runInstructions: String\(row\.run_instructions/);
  assert.match(runRepository, /input\.runInstructions/);
  assert.match(types, /trigger: RunTrigger/);
  assert.match(types, /mode: RunMode/);
  assert.match(types, /issueKey: string \| null/);
});

test("the development coordinator dispatches through the latest HMR module closure", async () => {
  const coordination = await read("lib/work-coordination.ts");
  assert.match(
    coordination,
    /state\.slabWorkCoordinatorTick = tickWorkCoordination/,
  );
  assert.match(coordination, /state\.slabWorkCoordinatorTick\?\.\(\)/);
});
