import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
register("./test-alias-loader.mjs", import.meta.url);

test("usage summary separates billed, estimated, and unpriced usage", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-usage-summary-"));
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
    budget,
    { getUsageSummary },
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/budget-control.ts"),
    import("../lib/usage-summary.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Finance Operator",
    slug: "finance-operator",
    role: "Operations",
    instructions: "Track work carefully.",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(agent.id, "Usage tests");
  const makeRun = (id, runtime, model = "default") =>
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
  const configuration = budget.getBudgetConfiguration();
  budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: null,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [
      {
        runtimeId: "codex",
        model: "priced-model",
        inputUsdPerMillion: 2,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 4,
      },
    ],
  });
  const timestamp = new Date("2026-08-27T12:00:00Z");
  const cases = [
    {
      run: makeRun("summary-codex", "codex", "priced-model"),
      event: {
        inputTokens: 1_000,
        cachedInputTokens: 200,
        outputTokens: 100,
        totalTokens: 1_100,
      },
    },
    {
      run: makeRun("summary-claude", "claude"),
      event: {
        usageScope: "run_aggregate",
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        totalCostUsd: 0.5,
        costSource: "sdk_estimated",
      },
    },
    {
      run: makeRun("summary-openrouter", "openrouter", "provider/model"),
      event: {
        inputTokens: 40,
        outputTokens: 10,
        totalTokens: 50,
        costUsd: 0.25,
        costSource: "provider_reported",
      },
    },
    {
      run: makeRun("summary-gemini", "gemini"),
      event: {
        usageScope: "run_aggregate",
        inputTokens: 60,
        outputTokens: 15,
        totalTokens: 75,
      },
    },
  ];

  for (const [index, item] of cases.entries()) {
    assert.equal(
      budget.admitRunBudget(item.run, agent, timestamp).allowed,
      true,
    );
    budget.observeRunUsage(
      item.run.id,
      `runner-${index}:1`,
      item.event,
      `runner-${index}`,
    );
    if (index < cases.length - 1) {
      runRepository.updateRun(item.run.id, "completed");
      budget.settleRunBudget(item.run.id, "completed");
    }
  }

  const summary = getUsageSummary("all", new Date("2026-08-27T13:00:00Z"));
  assert.equal(summary.basis, "budget_admission_at");
  assert.equal(summary.costs.providerReportedUsd, 0.25);
  assert.equal(summary.costs.sdkEstimatedUsd, 0.5);
  assert.equal(summary.costs.pricingEstimatedUsd, 0.0021);
  assert.equal(summary.costs.trackedUsd, 0.7521);
  assert.deepEqual(summary.runs, {
    total: 4,
    priced: 3,
    unpriced: 1,
    active: 1,
  });
  assert.equal(summary.tokens.total, 1_325);
  assert.equal(summary.tokens.unpriced, 75);
  assert.equal(summary.breakdowns.runtimes.length, 4);
  assert.equal(
    summary.breakdowns.agents[0]?.providerReportedUsd,
    summary.costs.providerReportedUsd,
  );

  const withLimit = budget.getBudgetConfiguration();
  budget.updateBudgetConfiguration({
    expectedVersion: withLimit.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 10,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: withLimit.agents,
    prices: withLimit.prices.map((price) => ({
      runtimeId: price.runtimeId,
      model: price.model,
      inputUsdPerMillion: price.inputUsdPerMillion,
      cachedInputUsdPerMillion: price.cachedInputUsdPerMillion,
      outputUsdPerMillion: price.outputUsdPerMillion,
    })),
  });
  const exceeded = makeRun("summary-exceeded", "openrouter", "provider/model");
  assert.equal(budget.admitRunBudget(exceeded, agent, timestamp).allowed, true);
  runRepository.updateRun(exceeded.id, "running");
  budget.markRunBudgetExceeded(exceeded.id);
  const whileCancelling = getUsageSummary(
    "today",
    new Date("2026-08-27T13:00:00Z"),
  );
  assert.equal(whileCancelling.budgets.day.activeReservedUsd, 10);
  assert.equal(whileCancelling.budgets.day.committedUsd, 10.7521);
  assert.equal(whileCancelling.runs.active, 2);

  runRepository.updateRun(exceeded.id, "failed");
  budget.settleRunBudget(exceeded.id, "failed");
  const afterSettlement = getUsageSummary(
    "today",
    new Date("2026-08-27T13:00:00Z"),
  );
  assert.equal(afterSettlement.budgets.day.activeReservedUsd, 0);
});
