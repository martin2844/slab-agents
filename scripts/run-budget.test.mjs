import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
register("./test-alias-loader.mjs", import.meta.url);

test("budget admission reserves atomically, reconciles idempotently, and preserves pricing snapshots", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-run-budget-"));
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
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/budget-control.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Budget Agent",
    slug: "budget-agent",
    role: "Operations",
    instructions: "Use the available budget carefully.",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(agent.id, "Budget tests");
  const makeRun = (id, runtime = "codex", model = "priced-model") =>
    runRepository.createRun({
      id,
      agentId: agent.id,
      threadId: thread.id,
      runtime,
      model,
      trigger: "manual",
      mode: "task",
      runInstructions: "Complete the task.",
    });

  let configuration = budget.getBudgetConfiguration();
  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: 2_000_000,
      maxCostUsdPerRun: 10,
      dailyCostUsd: 10,
      monthlyCostUsd: 100,
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
  const first = makeRun("budget-first");
  const second = makeRun("budget-second");
  const firstAdmission = budget.admitRunBudget(
    first,
    agent,
    new Date("2026-08-24T12:00:00Z"),
  );
  const secondAdmission = budget.admitRunBudget(
    second,
    agent,
    new Date("2026-08-24T12:00:01Z"),
  );
  assert.equal(firstAdmission.allowed, true);
  assert.equal(secondAdmission.allowed, false);
  assert.equal(secondAdmission.snapshot.reason, "daily_budget_exhausted");
  assert.deepEqual(
    budget.admitRunBudget(first, agent, new Date("2026-08-24T12:00:02Z")),
    firstAdmission,
    "reconnect admission must reuse the same reservation",
  );
  assert.equal(
    firstAdmission.allowed && firstAdmission.runtimeBudget.pricing?.version,
    1,
  );

  const usage = {
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
    totalTokens: 1_100_000,
  };
  const observed = budget.observeRunUsage(first.id, "runner:1", usage);
  assert.equal(observed?.snapshot.actualCostUsd, 2.1);
  assert.equal(observed?.snapshot.actualCostSource, "pricing_snapshot");
  assert.equal(observed?.snapshot.actualTokens, 1_100_000);
  const duplicate = budget.observeRunUsage(first.id, "runner:1", usage);
  assert.equal(duplicate?.snapshot.actualCostUsd, 2.1);
  budget.settleRunBudget(first.id, "completed");

  const third = makeRun("budget-third");
  assert.equal(
    budget.admitRunBudget(third, agent, new Date("2026-08-24T12:01:00Z"))
      .allowed,
    false,
    "a full per-run reservation still cannot fit in the remaining daily exposure",
  );

  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: 100,
      maxCostUsdPerRun: null,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  assert.equal(
    budget.getRunBudget(first.id)?.pricingVersion,
    1,
    "catalog edits must not rewrite a historical pricing snapshot",
  );
  const tokenOnly = makeRun("token-only", "codex", "default");
  assert.equal(budget.admitRunBudget(tokenOnly, agent).allowed, true);
  const unsupportedClaudeTokenLimit = makeRun(
    "unsupported-claude-token-limit",
    "claude",
    "default",
  );
  const unsupportedAdmission = budget.admitRunBudget(
    unsupportedClaudeTokenLimit,
    agent,
  );
  assert.equal(unsupportedAdmission.allowed, false);
  assert.equal(unsupportedAdmission.snapshot.reason, "token_limit_unavailable");
  const over = budget.observeRunUsage(tokenOnly.id, "runner:1", {
    inputTokens: 101,
    totalTokens: 101,
  });
  assert.equal(over?.newlyExceeded, true);
  assert.equal(over?.reason, "token_limit_exceeded");

  assert.throws(
    () =>
      budget.updateBudgetConfiguration({
        expectedVersion: configuration.workspace.version,
        workspace: {
          maxTokensPerRun: null,
          maxCostUsdPerRun: 0.0000001,
          dailyCostUsd: null,
          monthlyCostUsd: null,
        },
        agents: [],
        prices: [],
      }),
    /cannot be smaller than \$0\.000001/,
  );
  assert.throws(
    () =>
      budget.updateBudgetConfiguration({
        expectedVersion: configuration.workspace.version,
        workspace: {
          maxTokensPerRun: null,
          maxCostUsdPerRun: 0.0000005,
          dailyCostUsd: null,
          monthlyCostUsd: null,
        },
        agents: [],
        prices: [],
      }),
    /cannot be smaller than \$0\.000001/,
  );
  assert.throws(
    () =>
      budget.updateBudgetConfiguration({
        expectedVersion: configuration.workspace.version,
        workspace: {
          maxTokensPerRun: null,
          maxCostUsdPerRun: 0.0000015,
          dailyCostUsd: null,
          monthlyCostUsd: null,
        },
        agents: [],
        prices: [],
      }),
    /cannot have more than 6 decimal places/,
  );

  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 0.000001,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  assert.equal(configuration.workspace.maxCostUsdPerRun, 0.000001);

  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 543068.707658,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  assert.equal(configuration.workspace.maxCostUsdPerRun, 543068.707658);

  budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 5,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  const estimatedCodex = makeRun("estimated-codex", "codex", "default");
  const codexAdmission = budget.admitRunBudget(estimatedCodex, agent);
  assert.equal(codexAdmission.allowed, true);
  assert.equal(
    codexAdmission.allowed &&
      codexAdmission.runtimeBudget.pricing?.inputUsdPerMillion,
    4,
  );
  const nativeClaude = makeRun("native-claude", "claude", "default");
  const claudeAdmission = budget.admitRunBudget(nativeClaude, agent);
  assert.equal(claudeAdmission.allowed, true);
  assert.equal(
    claudeAdmission.allowed && claudeAdmission.runtimeBudget.maxCostUsd,
    5,
  );
  assert.equal(
    claudeAdmission.allowed && claudeAdmission.runtimeBudget.pricing,
    null,
  );
  budget.observeRunUsage(
    nativeClaude.id,
    "runner:1",
    {
      usageScope: "run_aggregate",
      totalTokens: 50,
      totalCostUsd: 1.5,
      costSource: "sdk_estimated",
    },
    "claude-execution-1",
  );
  const latestAggregate = budget.observeRunUsage(
    nativeClaude.id,
    "runner:2",
    {
      usageScope: "run_aggregate",
      totalTokens: 75,
      totalCostUsd: 2,
      costSource: "sdk_estimated",
    },
    "claude-execution-1",
  );
  assert.equal(latestAggregate?.snapshot.actualTokens, 75);
  assert.equal(latestAggregate?.snapshot.actualCostUsd, 2);
  assert.equal(latestAggregate?.snapshot.actualCostSource, "sdk_estimated");
  const retriedAggregate = budget.observeRunUsage(
    nativeClaude.id,
    "retry:1",
    {
      usageScope: "run_aggregate",
      totalTokens: 25,
      totalCostUsd: 0.5,
      costSource: "sdk_estimated",
    },
    "claude-execution-2",
  );
  assert.equal(
    retriedAggregate?.snapshot.actualTokens,
    100,
    "aggregate usage must replace earlier updates within an execution and sum across retries",
  );
  assert.equal(retriedAggregate?.snapshot.actualCostUsd, 2.5);

  const perCallCosts = makeRun(
    "per-call-costs",
    "openrouter",
    "provider/tool-model",
  );
  const openRouterAdmission = budget.admitRunBudget(perCallCosts, agent);
  assert.equal(openRouterAdmission.allowed, true);
  assert.equal(
    openRouterAdmission.allowed && openRouterAdmission.runtimeBudget.maxCostUsd,
    5,
  );
  assert.equal(
    openRouterAdmission.allowed && openRouterAdmission.runtimeBudget.pricing,
    null,
    "exact OpenRouter cost events must not require operator-entered prices",
  );
  budget.observeRunUsage(perCallCosts.id, "runner:1", {
    usageScope: "model_call",
    totalTokens: 10,
    costUsd: 0.2,
    costSource: "provider_reported",
    totalCostUsd: 0.2,
  });
  const secondCall = budget.observeRunUsage(perCallCosts.id, "runner:2", {
    usageScope: "model_call",
    totalTokens: 20,
    costUsd: 0.3,
    costSource: "provider_reported",
    totalCostUsd: 0.5,
  });
  assert.equal(secondCall?.snapshot.actualTokens, 30);
  assert.equal(
    secondCall?.snapshot.actualCostUsd,
    0.5,
    "model-call costs must sum per-call values without summing cumulative totals",
  );
  assert.equal(secondCall?.snapshot.actualCostSource, "provider_reported");

  const legacyClaude = makeRun("legacy-claude", "claude", "default");
  assert.equal(budget.admitRunBudget(legacyClaude, agent).allowed, true);
  const legacyCost = budget.observeRunUsage(legacyClaude.id, "legacy:1", {
    usageScope: "run_aggregate",
    totalTokens: 10,
    totalCostUsd: 0.1,
  });
  assert.equal(
    legacyCost?.snapshot.actualCostSource,
    "sdk_estimated",
    "older Runner events must retain truthful provenance during a rolling upgrade",
  );
});
