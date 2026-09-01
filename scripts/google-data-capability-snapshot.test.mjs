import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

test("Google data tools remain an immutable per-run capability snapshot", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-google-data-"));
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

  const [
    { agentRepository },
    { conversationRepository },
    { integrationRepository },
    { runRepository },
    { getAgentGoogleDataIntegrationsMcp },
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/integration-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/integrations/google-data-service.ts"),
  ]);

  const agent = agentRepository.createAgent({
    name: "Growth",
    slug: "growth-google-snapshot",
    role: "Growth operator",
    instructions: "Inspect acquisition signals.",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(
    agent.id,
    "Google snapshot test",
  );
  const createRun = () =>
    runRepository.createRun({
      agentId: agent.id,
      threadId: thread.id,
      runtime: "codex",
      model: "default",
      trigger: "manual",
      mode: "task",
      runInstructions: "Inspect acquisition.",
    });

  const runBeforeConnection = createRun();
  assert.deepEqual(
    getAgentGoogleDataIntegrationsMcp(agent.id, runBeforeConnection.id),
    [],
  );

  const integration = integrationRepository.saveIntegration({
    provider: "google_analytics",
    name: "Google Analytics",
    config: { authType: "none", oauthConfigured: true },
    credentialsCiphertext: "encrypted-test-value",
    status: "connected",
    lastTestedAt: new Date().toISOString(),
    lastError: null,
    permissions: {
      [agent.id]: ["google_analytics_list_properties"],
    },
  });

  assert.deepEqual(
    getAgentGoogleDataIntegrationsMcp(agent.id, runBeforeConnection.id),
    [],
  );

  const firstRun = createRun();
  const firstSnapshot = getAgentGoogleDataIntegrationsMcp(
    agent.id,
    firstRun.id,
  );
  assert.equal(firstSnapshot.length, 1);
  assert.deepEqual(firstSnapshot[0].snapshot.tools, [
    "google_analytics_list_properties",
  ]);
  assert.deepEqual(firstSnapshot[0].server.approval, {
    defaultMode: "approve",
    tools: {},
  });
  assert.doesNotMatch(
    JSON.stringify(firstSnapshot[0].snapshot),
    /encrypted-test-value/,
  );

  const current = integrationRepository.getIntegration(integration.id);
  integrationRepository.saveIntegration({
    id: integration.id,
    expectedVersion: current.version,
    provider: "google_analytics",
    name: current.name,
    config: { authType: "none", oauthConfigured: true },
    credentialsCiphertext: "rotated-encrypted-test-value",
    status: "connected",
    lastTestedAt: new Date().toISOString(),
    lastError: null,
    permissions: {
      [agent.id]: [
        "google_analytics_list_properties",
        "google_analytics_run_report",
      ],
    },
  });

  const firstRetry = getAgentGoogleDataIntegrationsMcp(agent.id, firstRun.id);
  assert.deepEqual(firstRetry[0].snapshot.tools, firstSnapshot[0].snapshot.tools);
  assert.equal(firstRetry[0].snapshot.version, firstSnapshot[0].snapshot.version);

  const nextRun = createRun();
  const nextSnapshot = getAgentGoogleDataIntegrationsMcp(agent.id, nextRun.id);
  assert.deepEqual(nextSnapshot[0].snapshot.tools, [
    "google_analytics_list_properties",
    "google_analytics_run_report",
  ]);
  assert.notEqual(nextSnapshot[0].snapshot.version, firstSnapshot[0].snapshot.version);
});
