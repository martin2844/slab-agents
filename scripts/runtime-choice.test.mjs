import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
register("./test-alias-loader.mjs", import.meta.url);

test("runtime configuration, model selection, and credentials stay server-side", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-runtime-choice-"));
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
    { repository },
    runtimeConfig,
    runtimeService,
    { createRunExecution },
    setup,
  ] = await Promise.all([
    import("../lib/repository.ts"),
    import("../lib/runtime-config.ts"),
    import("../lib/runtime-service.ts"),
    import("../lib/run-service.ts"),
    import("../lib/setup.ts"),
  ]);

  const rawKey = "sk-ant-runtime-choice-secret-should-never-leak";
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "claude",
    apiKey: rawKey,
  });
  const stored = repository.getRuntimeConfig("claude");
  assert.ok(stored?.credentialCiphertext);
  assert.doesNotMatch(stored.credentialCiphertext, /runtime-choice-secret/);

  await runtimeService.testRuntime("claude", {
    fetcher: async (url, init) => {
      assert.equal(
        String(url),
        "https://api.anthropic.com/v1/models?limit=100",
      );
      assert.equal(init?.headers["x-api-key"], rawKey);
      return Response.json({
        data: [{ id: "claude-sonnet-4-20250514" }, { id: "claude-opus-4-1" }],
      });
    },
    now: () => "2026-08-24T12:00:00.000Z",
  });
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "claude",
    enabled: true,
    defaultModel: "claude-sonnet-4-20250514",
  });

  let releaseDiscovery;
  let discoveryStarted;
  const started = new Promise((resolve) => {
    discoveryStarted = resolve;
  });
  const discovery = new Promise((resolve) => {
    releaseDiscovery = resolve;
  });
  const staleTest = runtimeService.testRuntime("claude", {
    fetcher: async (_url, init) => {
      assert.equal(init?.headers["x-api-key"], rawKey);
      discoveryStarted();
      await discovery;
      return Response.json({ data: [{ id: "stale-model" }] });
    },
  });
  await started;
  const rotatedKey = "sk-ant-rotated-secret-must-win-the-race";
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "claude",
    apiKey: rotatedKey,
  });
  const rotated = repository.getRuntimeConfig("claude");
  releaseDiscovery();
  await assert.rejects(staleTest, /configuration changed/i);
  const afterStaleTest = repository.getRuntimeConfig("claude");
  assert.equal(
    afterStaleTest?.credentialCiphertext,
    rotated?.credentialCiphertext,
    "a stale runtime test must not restore the previous encrypted key",
  );
  assert.equal(
    runtimeConfig.getRuntimeAuthentication("claude").credential,
    rotatedKey,
  );
  assert.deepEqual(afterStaleTest?.models, rotated?.models);
  await runtimeService.testRuntime("claude", {
    fetcher: async (_url, init) => {
      assert.equal(init?.headers["x-api-key"], rotatedKey);
      return Response.json({ data: [{ id: "claude-sonnet-4-20250514" }] });
    },
  });

  const directKey = "openai-compatible-secret-never-returned";
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "direct_api",
    apiKey: directKey,
    baseUrl: "https://provider.example.test/v1/",
    apiFormat: "chat_completions",
    defaultModel: "kimi-test",
  });
  const storedDirect = repository.getRuntimeConfig("direct_api");
  assert.equal(storedDirect?.baseUrl, "https://provider.example.test/v1");
  assert.equal(storedDirect?.apiFormat, "chat_completions");
  assert.ok(storedDirect?.credentialCiphertext);
  assert.doesNotMatch(storedDirect.credentialCiphertext, /never-returned/);
  await runtimeService.testRuntime("direct_api", {
    fetcher: async (url, init) => {
      assert.equal(String(url), "https://provider.example.test/v1/models");
      assert.equal(init?.headers.Authorization, `Bearer ${directKey}`);
      assert.equal(init?.redirect, "manual");
      return Response.json({
        data: [{ id: "kimi-test" }, { id: "kimi-fast" }],
      });
    },
    now: () => "2026-08-24T12:00:01.000Z",
  });
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "direct_api",
    enabled: true,
    defaultModel: "kimi-test",
  });
  assert.equal(
    repository.getRuntimeConfig("direct_api")?.lastVerificationStatus,
    "connected",
    "enable/model-only saves must preserve a current connection verification",
  );
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "direct_api",
    baseUrl: "https://provider.example.test/v1/",
    apiFormat: "chat_completions",
  });
  assert.equal(
    repository.getRuntimeConfig("direct_api")?.lastVerificationStatus,
    "connected",
    "equivalent normalized endpoint fields must preserve verification",
  );
  assert.deepEqual(runtimeConfig.getRuntimeAuthentication("direct_api"), {
    mode: "api_key",
    credential: directKey,
    baseUrl: "https://provider.example.test/v1",
    apiFormat: "chat_completions",
  });
  assert.throws(
    () =>
      runtimeConfig.saveRuntimeConfiguration({
        runtimeId: "direct_api",
        baseUrl: "https://provider.example.test/v1?redirect=https://evil.test",
      }),
    /query string or fragment/,
  );

  let testedRuntime = null;
  await runtimeService.testRuntime("gemini", {
    testRuntimeOwned: async (runtimeId) => {
      testedRuntime = runtimeId;
    },
    now: () => "2026-08-24T12:00:02.000Z",
  });
  assert.equal(testedRuntime, "gemini");
  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "gemini",
    enabled: true,
  });
  assert.throws(
    () =>
      runtimeConfig.saveRuntimeConfiguration({
        runtimeId: "gemini",
        apiKey: "must-never-be-stored",
      }),
    /authentication is owned by slab-runner/,
  );

  const agent = repository.createAgent({
    name: "Claude Operator",
    slug: "claude-operator",
    role: "Operations",
    instructions: "Operate through the configured Claude runtime.",
    runtime: "claude",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = repository.createThread(agent.id, "Runtime selection");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "Confirm the selected runtime.",
  });
  assert.equal(run.runtime, "claude");
  assert.equal(run.model, "claude-sonnet-4-20250514");

  const directAgent = repository.createAgent({
    name: "Direct Operator",
    slug: "direct-operator",
    role: "Operations",
    instructions: "Operate through the configured Direct API runtime.",
    runtime: "direct_api",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const directThread = repository.createThread(
    directAgent.id,
    "Direct runtime",
  );
  const directRun = createRunExecution({
    agentId: directAgent.id,
    threadId: directThread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "Confirm the direct runtime.",
  });
  assert.equal(directRun.runtime, "direct_api");
  assert.equal(directRun.model, "kimi-test");

  const geminiAgent = repository.createAgent({
    name: "Gemini Operator",
    slug: "gemini-operator",
    role: "Operations",
    instructions: "Operate through the configured Gemini runtime.",
    runtime: "gemini",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const geminiThread = repository.createThread(
    geminiAgent.id,
    "Gemini runtime",
  );
  const geminiRun = createRunExecution({
    agentId: geminiAgent.id,
    threadId: geminiThread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "Confirm the Gemini runtime.",
  });
  assert.equal(geminiRun.runtime, "gemini");
  assert.equal(geminiRun.model, "default");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [
        {
          id: "codex",
          displayName: "Codex",
          stability: "stable",
          authModes: ["chatgpt"],
          capabilities: {},
          available: true,
          status: "available",
          reasonCode: "ready",
          authentication: { status: "authenticated", mode: "chatgpt" },
          checkedAt: "2026-08-24T12:00:00.000Z",
        },
        {
          id: "gemini",
          displayName: "Gemini CLI",
          stability: "experimental",
          authModes: ["oauth"],
          capabilities: {},
          available: true,
          status: "available",
          reasonCode: "ready",
          authentication: { status: "authenticated", mode: "oauth" },
          checkedAt: "2026-08-24T12:00:00.000Z",
        },
        {
          id: "claude",
          displayName: "Claude Agent",
          stability: "experimental",
          authModes: ["api_key"],
          capabilities: {},
          available: false,
          status: "authentication_required",
          reasonCode: "authentication_required",
          authentication: { status: "required", mode: "api_key" },
          checkedAt: "2026-08-24T12:00:00.000Z",
        },
      ],
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const publicCatalog = await runtimeService.listRuntimeCatalog();
  const serialized = JSON.stringify(publicCatalog);
  assert.doesNotMatch(serialized, /runtime-choice-secret/);
  assert.doesNotMatch(serialized, /credentialCiphertext|credential_ciphertext/);
  assert.doesNotMatch(serialized, /openai-compatible-secret/);
  assert.equal(
    publicCatalog.find(({ id }) => id === "claude")?.configured,
    true,
  );
  assert.equal(
    publicCatalog.find(({ id }) => id === "gemini")?.health,
    "available",
  );

  const fullRunnerFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [
        {
          id: "codex",
          displayName: "Codex",
          stability: "stable",
          available: true,
          status: "available",
          reasonCode: "ready",
          authentication: { status: "authenticated", mode: "chatgpt" },
          checkedAt: "2026-08-24T12:00:30.000Z",
        },
      ],
    });
  const legacyRunnerCatalog = await runtimeService.listRuntimeCatalog();
  assert.deepEqual(
    legacyRunnerCatalog.find(({ id }) => id === "codex")?.authModes,
    ["chatgpt", "api_key", "cloud_provider"],
  );
  assert.deepEqual(
    legacyRunnerCatalog.find(({ id }) => id === "codex")?.capabilities,
    {},
  );
  globalThis.fetch = fullRunnerFetch;

  runtimeConfig.saveRuntimeConfiguration({
    runtimeId: "codex",
    enabled: false,
  });
  const runtimeSetup = await setup.runSetupCheck("codex");
  const runtimeCheck = runtimeSetup.checks.find(
    ({ service }) => service === "codex",
  );
  assert.equal(runtimeCheck?.state, "connected");
  assert.match(runtimeCheck?.detail ?? "", /Claude Agent is available/);

  globalThis.fetch = async () =>
    Response.json({
      data: [
        {
          id: "claude",
          displayName: "Claude Agent",
          stability: "experimental",
          authModes: ["api_key"],
          capabilities: {},
          available: false,
          status: "unavailable",
          reasonCode: "not_started",
          authentication: { status: "unknown", mode: null },
          checkedAt: "2026-08-24T12:01:00.000Z",
        },
      ],
    });
  const unavailableCatalog = await runtimeService.listRuntimeCatalog();
  assert.equal(
    unavailableCatalog.find(({ id }) => id === "claude")?.health,
    "unavailable",
  );
});

test("runtime UI is write-only for provider credentials and run audit shows selection", async () => {
  const [
    settings,
    runDetail,
    migration,
    directMigration,
    geminiMigration,
  ] = await Promise.all([
    readFile(
      new URL("../components/runtime-settings.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../components/run-detail.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../db/migrations/202608240022_runtime_provider_choice.cjs",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../db/migrations/202608240024_direct_api_runtime.cjs",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../db/migrations/202608240025_gemini_runtime.cjs",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(settings, /type="password"/);
  assert.match(settings, /Configured · replace only/);
  assert.doesNotMatch(settings, /credentialCiphertext|decryptLocalSecret/);
  assert.match(runDetail, /run\.runtime/);
  assert.match(runDetail, /run\.model/);
  assert.match(migration, /version|config_version/);
  assert.match(migration, /UPDATE threads SET runtime = 'codex'/);
  assert.match(settings, /OpenAI Responses/);
  assert.match(settings, /OpenAI-compatible Chat Completions/);
  assert.match(directMigration, /direct_api/);
  assert.match(geminiMigration, /gemini/);
  assert.match(geminiMigration, /runtime_owned/);
  assert.match(settings, /sudo slabctl gemini login/);
});
