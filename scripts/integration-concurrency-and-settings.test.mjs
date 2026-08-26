import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

test("custom integration saves and tests cannot overwrite a newer version", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "slab-integration-race-"),
  );
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

  const [
    { agentRepository },
    { integrationRepository },
    service,
    settings,
    { settingsRepository },
    calendarService,
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/integration-repository.ts"),
    import("../lib/integrations/service.ts"),
    import("../lib/settings.ts"),
    import("../lib/repositories/settings-repository.ts"),
    import("../lib/integrations/calendar-service.ts"),
  ]);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(null, { status: 204 });

  const operation = {
    key: "health",
    name: "Health",
    method: "GET",
    path: "/health",
  };
  const initial = await service.saveCustomHttpIntegration({
    name: "Initial",
    baseUrl: "https://connector.example.test",
    authType: "none",
    permissions: {},
    operations: [operation],
  });

  const releases = [];
  globalThis.fetch = () =>
    new Promise((resolve) => {
      releases.push(() => resolve(new Response(null, { status: 204 })));
    });
  const older = service.saveCustomHttpIntegration({
    id: initial.id,
    expectedVersion: initial.version,
    name: "Older request",
    baseUrl: "https://connector.example.test",
    authType: "none",
    permissions: {},
    operations: [operation],
  });
  const newer = service.saveCustomHttpIntegration({
    id: initial.id,
    expectedVersion: initial.version,
    name: "Newer request",
    baseUrl: "https://connector.example.test",
    authType: "none",
    permissions: {},
    operations: [operation],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2);
  releases[1]();
  await newer;
  releases[0]();
  await assert.rejects(older, /changed while it was being saved/i);
  assert.equal(
    integrationRepository.getIntegration(initial.id)?.name,
    "Newer request",
  );

  let releaseRetest;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      releaseRetest = () => resolve(new Response(null, { status: 204 }));
    });
  const staleRetest = service.retestCustomHttpIntegration(initial.id);
  await new Promise((resolve) => setImmediate(resolve));
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const beforeCurrentSave = integrationRepository.getIntegration(initial.id);
  assert.ok(beforeCurrentSave?.version);
  await service.saveCustomHttpIntegration({
    id: initial.id,
    expectedVersion: beforeCurrentSave.version,
    name: "Current configuration",
    baseUrl: "https://connector.example.test",
    authType: "none",
    permissions: {},
    operations: [operation],
  });
  releaseRetest();
  await assert.rejects(staleRetest, /changed while.*test/i);
  assert.equal(
    integrationRepository.getIntegration(initial.id)?.name,
    "Current configuration",
  );

  const agent = agentRepository.createAgent({
    name: "Sales",
    slug: "sales",
    role: "Sales",
    instructions: "Sell",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  let permissionVersion = integrationRepository.getIntegration(
    initial.id,
  ).version;
  integrationRepository.setAgentIntegrationTools(
    initial.id,
    agent.id,
    ["health"],
    permissionVersion,
  );
  permissionVersion = integrationRepository.getIntegration(initial.id).version;
  let releasePermissionRace;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      releasePermissionRace = () =>
        resolve(new Response(null, { status: 204 }));
    });
  const stalePermissionSave = service.saveCustomHttpIntegration({
    id: initial.id,
    expectedVersion: permissionVersion,
    name: "Stale permission editor",
    baseUrl: "https://connector.example.test",
    authType: "none",
    permissions: { [agent.id]: ["health"] },
    operations: [operation],
  });
  await new Promise((resolve) => setImmediate(resolve));
  integrationRepository.setAgentIntegrationTools(
    initial.id,
    agent.id,
    [],
    permissionVersion,
  );
  releasePermissionRace();
  await assert.rejects(
    stalePermissionSave,
    /changed while it was being saved/i,
  );
  assert.deepEqual(
    integrationRepository.listIntegrationPermissions(initial.id),
    {},
  );

  await assert.rejects(
    service.saveCustomHttpIntegration({
      id: initial.id,
      expectedVersion: initial.version,
      name: "Sequential stale editor",
      baseUrl: "https://connector.example.test",
      authType: "none",
      permissions: {},
      operations: [operation],
    }),
    /changed while it was being saved/i,
  );
  assert.equal(
    integrationRepository.getIntegration(initial.id)?.name,
    "Current configuration",
  );

  settingsRepository.set("work_api_key", "legacy-plaintext-key");
  assert.equal(settings.getSetting("work_api_key"), "legacy-plaintext-key");
  const encrypted = settingsRepository.get("work_api_key");
  assert.match(encrypted, /^encrypted:v1\./);
  assert.doesNotMatch(encrypted, /legacy-plaintext-key/);

  settingsRepository.set("work_api_key", "v1.legacy-reader-key");
  assert.equal(settings.getSetting("work_api_key"), "v1.legacy-reader-key");
  assert.notEqual(
    settingsRepository.get("work_api_key"),
    "v1.legacy-reader-key",
  );

  settingsRepository.set("work_api_key", "stale-legacy-key");
  const originalCompareAndSet = settingsRepository.compareAndSet;
  settingsRepository.compareAndSet = (key, expectedValue, value) => {
    settings.setSetting("work_api_key", "concurrent-new-key");
    return originalCompareAndSet.call(
      settingsRepository,
      key,
      expectedValue,
      value,
    );
  };
  try {
    assert.equal(settings.getSetting("work_api_key"), "concurrent-new-key");
    assert.equal(settings.getSetting("work_api_key"), "concurrent-new-key");
  } finally {
    settingsRepository.compareAndSet = originalCompareAndSet;
  }

  settings.setSetting("honcho_api_key", "honcho-secret-value");
  assert.equal(settings.getSetting("honcho_api_key"), "honcho-secret-value");
  assert.match(settingsRepository.get("honcho_api_key"), /^encrypted:v1\./);
  assert.doesNotMatch(
    settingsRepository.get("honcho_api_key"),
    /honcho-secret-value/,
  );
  assert.equal(settings.getPublicSettings().honchoApiKeyConfigured, true);
  assert.equal("honchoApiKey" in settings.getPublicSettings(), false);

  const rawSecret = "mcp-super-secret";
  globalThis.fetch = async () => {
    throw new Error(`upstream echoed Authorization: Bearer ${rawSecret}`);
  };
  const failedMcp = await service.saveCustomMcpIntegration({
    name: "Secret-safe MCP",
    baseUrl: "https://mcp.example.test/mcp",
    authType: "bearer",
    secret: rawSecret,
    permissions: {},
  });
  assert.equal(failedMcp.status, "failed");
  assert.doesNotMatch(failedMcp.lastError ?? "", new RegExp(rawSecret));
  assert.match(failedMcp.lastError ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(
    integrationRepository.getIntegration(failedMcp.id)?.lastError ?? "",
    new RegExp(rawSecret),
  );

  const deleteVersion = integrationRepository.getIntegration(
    failedMcp.id,
  ).version;
  assert.throws(
    () =>
      integrationRepository.deleteIntegration(failedMcp.id, deleteVersion - 1),
    /changed while it was being saved/i,
  );
  assert.ok(integrationRepository.getIntegration(failedMcp.id));
  integrationRepository.deleteIntegration(failedMcp.id, deleteVersion);
  assert.equal(integrationRepository.getIntegration(failedMcp.id), null);

  const posthogReleases = [];
  globalThis.fetch = () =>
    new Promise((resolve) => {
      posthogReleases.push(() => resolve(Response.json({ results: [] })));
    });
  const input = {
    apiKey: "phx_test_key",
    datacenter: "us",
    permissions: {},
  };
  const first = service.savePostHogIntegration(input);
  const second = service.savePostHogIntegration(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posthogReleases.length, 2);
  posthogReleases[1]();
  await second;
  posthogReleases[0]();
  await assert.rejects(first, /created by another request/i);
  assert.equal(
    integrationRepository
      .listIntegrationRecords()
      .filter((record) => record.provider === "posthog").length,
    1,
  );

  const calendar = await calendarService.saveCalendarIntegration({
    provider: "calendar_google",
    name: "Primary calendar",
    clientId: "client-id",
    clientSecret: "client-secret",
    agentIds: [],
  });
  const newerCalendar = await calendarService.saveCalendarIntegration({
    id: calendar.id,
    expectedVersion: calendar.version,
    provider: "calendar_google",
    name: "Newer calendar name",
    agentIds: [],
  });
  await assert.rejects(
    calendarService.saveCalendarIntegration({
      id: calendar.id,
      expectedVersion: calendar.version,
      provider: "calendar_google",
      name: "Stale calendar name",
      agentIds: [],
    }),
    /changed while it was being saved/i,
  );
  assert.throws(
    () =>
      calendarService.setCalendarIntegrationEnabled(
        calendar.id,
        false,
        calendar.version,
      ),
    /changed while it was being saved/i,
  );
  assert.equal(
    integrationRepository.getIntegration(calendar.id).name,
    newerCalendar.name,
  );
});
