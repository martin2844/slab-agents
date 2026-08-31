import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
register("./test-alias-loader.mjs", import.meta.url);

test("bundled model prices are overridable and resolve Codex defaults", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-default-pricing-"));
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
    { conversationRepository },
    { runRepository },
    { budgetRepository },
    budget,
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/repositories/budget-repository.ts"),
    import("../lib/budget-control.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Pricing Agent",
    slug: "pricing-agent",
    role: "Operations",
    instructions: "Track API spend.",
    model: "gpt-5.4",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(agent.id, "Pricing tests");
  const makeRun = (id, runtime = "direct_api", model = "gpt-5.4") =>
    runRepository.createRun({
      id,
      agentId: agent.id,
      threadId: thread.id,
      runtime,
      model,
      trigger: "manual",
      mode: "task",
      runInstructions: "Measure this run.",
    });

  let configuration = budget.getBudgetConfiguration();
  const bundled = configuration.defaultPrices.find(
    ({ runtimeId, model }) => runtimeId === "direct_api" && model === "gpt-5.4",
  );
  assert.deepEqual(bundled, {
    runtimeId: "direct_api",
    model: "gpt-5.4",
    version: 2_026_083_101,
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15,
  });
  assert.deepEqual(
    configuration.defaultPrices.find(
      ({ runtimeId, model }) => runtimeId === "codex" && model === "default",
    ),
    {
      runtimeId: "codex",
      model: "default",
      version: 2_026_083_101,
      inputUsdPerMillion: 4,
      cachedInputUsdPerMillion: 0.4,
      outputUsdPerMillion: 20,
    },
  );
  assert.equal(configuration.prices.length, 0);
  assert.equal(configuration.pricingCatalog.name, "CodeBurn / LiteLLM");
  assert.match(
    configuration.pricingCatalog.sourceUrl,
    new RegExp(configuration.pricingCatalog.snapshotCommit),
  );

  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 100,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  const defaultRun = makeRun("default-price");
  const defaultAdmission = budget.admitRunBudget(defaultRun, agent);
  assert.equal(defaultAdmission.allowed, true);
  assert.deepEqual(
    defaultAdmission.allowed && defaultAdmission.runtimeBudget.pricing,
    {
      version: 2_026_083_101,
      inputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 15,
    },
  );

  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 100,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [
      {
        runtimeId: "direct_api",
        model: "gpt-5.4",
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 2,
      },
    ],
  });
  assert.equal(configuration.prices.length, 1);
  assert.equal(configuration.defaultPrices.length > 1, true);

  const overrideRun = makeRun("operator-override");
  const overrideAdmission = budget.admitRunBudget(overrideRun, agent);
  assert.deepEqual(
    overrideAdmission.allowed && overrideAdmission.runtimeBudget.pricing,
    {
      version: 1,
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.1,
      outputUsdPerMillion: 2,
    },
  );

  const historical = budget.observeRunUsage(defaultRun.id, "runner:1", {
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
    totalTokens: 1_100_000,
  });
  assert.equal(
    historical?.snapshot.actualCostUsd,
    3.55,
    "an admitted run must retain its bundled pricing snapshot after an override",
  );
  const overridden = budget.observeRunUsage(overrideRun.id, "runner:1", {
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
    totalTokens: 1_100_000,
  });
  assert.equal(overridden?.snapshot.actualCostUsd, 1.02);

  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 100,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  const resetRun = makeRun("reset-default");
  const resetAdmission = budget.admitRunBudget(resetRun, agent);
  assert.equal(
    resetAdmission.allowed && resetAdmission.runtimeBudget.pricing?.version,
    2_026_083_101,
  );

  const subscriptionRun = makeRun("subscription", "codex", "default");
  const subscriptionAdmission = budget.admitRunBudget(subscriptionRun, agent);
  assert.equal(subscriptionAdmission.allowed, true);
  assert.equal(
    subscriptionAdmission.allowed &&
      subscriptionAdmission.runtimeBudget.pricing?.inputUsdPerMillion,
    4,
  );
  const subscriptionUsage = budget.observeRunUsage(
    subscriptionRun.id,
    "runner:1",
    {
      model: "gpt-5.6-terra",
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 100_000,
      totalTokens: 1_100_000,
    },
  );
  assert.equal(subscriptionUsage?.snapshot.actualCostUsd, 2.84);
  const resolvedReservation = budgetRepository.getReservation(
    subscriptionRun.id,
  );
  assert.equal(resolvedReservation?.model, "gpt-5.6-terra");
  assert.equal(resolvedReservation?.pricingVersion, 2_026_083_101);
  assert.equal(resolvedReservation?.inputRateMicroUsdPerMillion, 2_000_000);
  assert.equal(resolvedReservation?.cachedInputRateMicroUsdPerMillion, 200_000);
  assert.equal(resolvedReservation?.outputRateMicroUsdPerMillion, 12_000_000);
  assert.equal(runRepository.getRun(subscriptionRun.id)?.model, "gpt-5.6-terra");

  const replayedRun = makeRun("replayed-subscription", "codex", "default");
  assert.equal(budget.admitRunBudget(replayedRun, agent).allowed, true);
  budgetRepository.insertUsageObservation({
    runId: replayedRun.id,
    eventKey: "runner:1",
    runnerRunId: "runner",
    usageScope: "model_call",
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
    totalTokens: 1_100_000,
    providerCostMicroUsd: null,
    estimatedCostMicroUsd: null,
    costSource: null,
    timestamp: new Date().toISOString(),
  });
  const replayedUsage = budget.observeRunUsage(
    replayedRun.id,
    "runner:1",
    {
      model: "gpt-5.6-sol",
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 100_000,
      totalTokens: 1_100_000,
    },
  );
  assert.equal(replayedUsage?.snapshot.actualCostUsd, 5.28);
  assert.equal(
    budgetRepository.getReservation(replayedRun.id)?.model,
    "gpt-5.6-sol",
  );

  const privateModelRun = makeRun(
    "private-direct-api-model",
    "direct_api",
    "company-model",
  );
  const privateModelAdmission = budget.admitRunBudget(privateModelRun, agent);
  assert.equal(privateModelAdmission.allowed, false);
  assert.equal(privateModelAdmission.snapshot.reason, "pricing_unavailable");
});
