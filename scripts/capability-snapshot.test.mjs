import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

test("custom capabilities remain a per-run snapshot, including an empty snapshot", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-capability-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  await migrations.migrate.latest();
  await migrations.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;
  process.env.SLAB_INTERNAL_URL = "http://127.0.0.1:3009";

  const [{ repository }, service] = await Promise.all([
    import("../lib/repository.ts"),
    import("../lib/integrations/service.ts"),
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const agent = repository.createAgent({
    name: "Sales",
    slug: "sales-snapshot",
    role: "Sales",
    instructions: "Sell",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = repository.createThread(agent.id, "Snapshot test");
  const createRun = () =>
    repository.createRun({
      agentId: agent.id,
      threadId: thread.id,
      runtime: "codex",
      model: "default",
      trigger: "manual",
      mode: "task",
      runInstructions: "Test",
    });
  const runA = createRun();
  assert.deepEqual(service.getAgentCustomIntegrationsMcp(agent.id, runA.id), []);

  const firstOperation = {
    key: "health",
    name: "Health",
    method: "GET",
    path: "/health",
  };
  const integration = await service.saveCustomHttpIntegration({
    name: "Internal API",
    baseUrl: "https://internal.example.test",
    authType: "none",
    permissions: { [agent.id]: ["health"] },
    operations: [firstOperation],
  });

  // A retry/reconnect of the already-started run must not hot-plug the new tool.
  assert.deepEqual(service.getAgentCustomIntegrationsMcp(agent.id, runA.id), []);

  const runB = createRun();
  const snapshotB = service.getAgentCustomIntegrationsMcp(agent.id, runB.id);
  assert.equal(snapshotB.length, 1);
  assert.equal(snapshotB[0].snapshot.tools.length, 1);

  // Runs created before snapshot markers were introduced already have rows.
  // Their first retry must adopt those rows instead of recapturing live config.
  const legacyRun = createRun();
  repository.saveRunIntegrationCapability({
    runId: legacyRun.id,
    integrationId: integration.id,
    agentId: agent.id,
    integrationVersion: integration.version,
    tokenHash: "legacy-token-hash",
    allowedTools: snapshotB[0].snapshot.tools,
  });

  const current = repository.getIntegration(integration.id);
  await service.saveCustomHttpIntegration({
    id: integration.id,
    expectedVersion: current.version,
    name: integration.name,
    baseUrl: "https://internal.example.test",
    authType: "none",
    permissions: { [agent.id]: ["health", "details"] },
    operations: [
      firstOperation,
      { key: "details", name: "Details", method: "GET", path: "/details" },
    ],
  });

  const retryB = service.getAgentCustomIntegrationsMcp(agent.id, runB.id);
  assert.deepEqual(retryB[0].snapshot.tools, snapshotB[0].snapshot.tools);
  assert.equal(retryB[0].snapshot.version, snapshotB[0].snapshot.version);
  const legacyRetry = service.getAgentCustomIntegrationsMcp(
    agent.id,
    legacyRun.id,
  );
  assert.equal(legacyRetry[0].snapshot.version, integration.version);
  assert.deepEqual(legacyRetry[0].snapshot.tools, snapshotB[0].snapshot.tools);

  const runC = createRun();
  const snapshotC = service.getAgentCustomIntegrationsMcp(agent.id, runC.id);
  assert.equal(snapshotC[0].snapshot.tools.length, 2);
  assert.notEqual(snapshotC[0].snapshot.version, snapshotB[0].snapshot.version);
});
