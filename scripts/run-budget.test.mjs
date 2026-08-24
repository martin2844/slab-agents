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

  const [{ repository }, budget] = await Promise.all([
    import("../lib/repository.ts"),
    import("../lib/budget-control.ts"),
  ]);
  const agent = repository.createAgent({
    name: "Budget Agent",
    slug: "budget-agent",
    role: "Operations",
    instructions: "Use the available budget carefully.",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = repository.createThread(agent.id, "Budget tests");
  const makeRun = (id, runtime = "codex", model = "priced-model") =>
    repository.createRun({
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
  const over = budget.observeRunUsage(tokenOnly.id, "runner:1", {
    inputTokens: 101,
    totalTokens: 101,
  });
  assert.equal(over?.newlyExceeded, true);
  assert.equal(over?.reason, "token_limit_exceeded");

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
  const unpricedCodex = makeRun("unpriced-codex", "codex", "default");
  const rejected = budget.admitRunBudget(unpricedCodex, agent);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.snapshot.reason, "pricing_unavailable");
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
  budget.observeRunUsage(nativeClaude.id, "runner:1", {
    usageScope: "run_aggregate",
    totalTokens: 50,
    totalCostUsd: 1.5,
  });
  const latestAggregate = budget.observeRunUsage(nativeClaude.id, "runner:2", {
    usageScope: "run_aggregate",
    totalTokens: 75,
    totalCostUsd: 2,
  });
  assert.equal(latestAggregate?.snapshot.actualTokens, 75);
  assert.equal(latestAggregate?.snapshot.actualCostUsd, 2);
});

test("executeRun rejects before Runner and cancels when observed usage exceeds its ceiling", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "slab-run-budget-execution-"),
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

  const [{ repository }, budget, { createRunExecution, executeRun }] =
    await Promise.all([
      import(`../lib/repository.ts?execution=${Date.now()}`),
      import(`../lib/budget-control.ts?execution=${Date.now()}`),
      import(`../lib/run-service.ts?execution=${Date.now()}`),
    ]);
  const agent = repository.createAgent({
    name: "Execution Budget Agent",
    slug: "execution-budget-agent",
    role: "Operations",
    instructions: "Respect the run ceiling.",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = repository.createThread(agent.id, "Budget execution");
  let configuration = budget.getBudgetConfiguration();
  configuration = budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 1,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  const rejectedRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "This run must be rejected before runtime.",
  });
  let starts = 0;
  for await (const event of executeRun(
    { runId: rejectedRun.id },
    {
      startRunner: async () => {
        starts += 1;
        throw new Error("must not start");
      },
    },
  ))
    void event;
  assert.equal(starts, 0);
  assert.equal(repository.getRun(rejectedRun.id)?.status, "skipped");
  assert.equal(repository.getRun(rejectedRun.id)?.usage, null);
  assert.ok(
    repository
      .listRunEvents(rejectedRun.id)
      .some(({ type }) => type === "run_budget_rejected"),
  );
  assert.ok(
    !repository
      .listRunEvents(rejectedRun.id)
      .some(({ type }) => type === "run_started"),
  );

  budget.updateBudgetConfiguration({
    expectedVersion: configuration.workspace.version,
    workspace: {
      maxTokensPerRun: 5,
      maxCostUsdPerRun: null,
      dailyCostUsd: null,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [],
  });
  const limitedRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Use more than five tokens.",
  });
  const cancelled = [];
  const startRunner = async (input) => ({
    resumed: false,
    runnerStatus: "running",
    contextProfile: null,
    capabilitySnapshot: null,
    events: (async function* () {
      yield {
        id: 1,
        type: "usage.updated",
        runId: input.runId,
        timestamp: new Date().toISOString(),
        data: { inputTokens: 6, totalTokens: 6 },
      };
      yield {
        id: 2,
        type: "run.cancelled",
        runId: input.runId,
        timestamp: new Date().toISOString(),
        data: {},
      };
    })(),
  });
  for await (const event of executeRun(
    { runId: limitedRun.id },
    {
      startRunner,
      cancelRunner: async (runId) => {
        cancelled.push(runId);
        return true;
      },
    },
  ))
    void event;
  assert.deepEqual(cancelled, [limitedRun.id]);
  assert.equal(repository.getRun(limitedRun.id)?.status, "cancelled");
  assert.equal(budget.getRunBudget(limitedRun.id)?.status, "exceeded");
  assert.ok(
    repository
      .listRunEvents(limitedRun.id)
      .some(({ type }) => type === "run_budget_exceeded"),
  );
});
