import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("manual and background runs share one profiled executor", async () => {
  const [service, chat, coordination, runner] = await Promise.all([
    read("lib/run-service.ts"),
    read("app/api/chat/route.ts"),
    read("lib/work-coordination.ts"),
    read("lib/runner.ts"),
  ]);

  assert.match(service, /runner\.contextProfile\.then/);
  assert.match(service, /event\.type === "context\.bootstrap"/);
  assert.match(service, /executeRun\(\{ runId, prompt, source \}\)/);
  assert.match(chat, /executeRun\(/);
  assert.match(coordination, /executeAutomationRun\(run\.id, prompt, input\.type\)/);
  for (const key of [
    "agent_instructions",
    "work_coordination_instructions",
    "integration_instructions",
    "initial_user_input",
    "mcp_server_configuration",
  ]) {
    assert.match(runner, new RegExp(`key: "${key}"`));
  }
  assert.match(runner, /inspectMcpDefinitions/);
});

test("the development coordinator dispatches through the latest HMR module closure", async () => {
  const coordination = await read("lib/work-coordination.ts");
  assert.match(
    coordination,
    /state\.slabWorkCoordinatorTick = tickWorkCoordination/,
  );
  assert.match(coordination, /state\.slabWorkCoordinatorTick\?\.\(\)/);
});
