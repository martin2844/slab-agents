import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
register("./test-alias-loader.mjs", import.meta.url);

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

  const [
    { agentRepository },
    { conversationRepository },
    { runRepository },
    budget,
    { createRunExecution, executeRun },
    { startRunnerRun },
    { settingsRepository },
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/budget-control.ts"),
    import("../lib/run-service.ts"),
    import("../lib/runner.ts"),
    import("../lib/repositories/settings-repository.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Execution Budget Agent",
    slug: "execution-budget-agent",
    role: "Operations",
    instructions: "Respect the run ceiling.",
    model: "private-codex-model",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(
    agent.id,
    "Budget execution",
  );
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
  assert.equal(runRepository.getRun(rejectedRun.id)?.status, "skipped");
  assert.equal(runRepository.getRun(rejectedRun.id)?.usage, null);
  assert.ok(
    runRepository
      .listRunEvents(rejectedRun.id)
      .some(({ type }) => type === "run_budget_rejected"),
  );
  assert.ok(
    !runRepository
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
      observeBudget: (runId, eventKey, data, runnerRunId) => {
        assert.equal(
          runRepository.getRun(runId)?.runnerEventId,
          0,
          "usage must be accounted before its Runner cursor advances",
        );
        return budget.observeRunUsage(runId, eventKey, data, runnerRunId);
      },
      settleBudget: (runId, terminalStatus) => {
        assert.equal(runRepository.getRun(runId)?.status, terminalStatus);
        assert.equal(
          runRepository.getRun(runId)?.runnerEventId,
          1,
          "terminal settlement must happen before its Runner cursor advances",
        );
        return budget.settleRunBudget(runId, terminalStatus);
      },
      cancelRunner: async (runId) => {
        cancelled.push(runId);
        return true;
      },
    },
  ))
    void event;
  assert.deepEqual(cancelled, [limitedRun.id]);
  assert.equal(runRepository.getRun(limitedRun.id)?.status, "cancelled");
  assert.equal(budget.getRunBudget(limitedRun.id)?.status, "exceeded");
  assert.equal(budget.getRunBudget(limitedRun.id)?.terminalStatus, "cancelled");
  assert.ok(
    runRepository
      .listRunEvents(limitedRun.id)
      .some(({ type }) => type === "run_budget_exceeded"),
  );

  const retryRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Retry cancellation without releasing the queue to later work.",
  });
  let runnerStarts = 0;
  let cancellationAttempts = 0;
  const reconnectingRunner = async (input) => {
    runnerStarts += 1;
    if (runnerStarts === 2) assert.equal(input.attachOnly, true);
    return {
      resumed: runnerStarts === 2,
      runnerStatus: "running",
      contextProfile: null,
      capabilitySnapshot: null,
      events: (async function* () {
        if (runnerStarts === 1) {
          yield {
            id: 1,
            type: "usage.updated",
            runId: input.runId,
            timestamp: new Date().toISOString(),
            data: { inputTokens: 6, totalTokens: 6 },
          };
          return;
        }
        yield {
          id: 2,
          type: "run.cancelled",
          runId: input.runId,
          timestamp: new Date().toISOString(),
          data: {},
        };
      })(),
    };
  };
  const retryingCancel = async () => {
    cancellationAttempts += 1;
    if (cancellationAttempts === 1) {
      throw new Error("temporary cancellation transport failure");
    }
    return true;
  };
  for await (const event of executeRun(
    { runId: retryRun.id },
    { startRunner: reconnectingRunner, cancelRunner: retryingCancel },
  ))
    void event;
  assert.equal(runRepository.getRun(retryRun.id)?.status, "queued");
  assert.ok(
    runRepository
      .listRunEvents(retryRun.id)
      .some(({ type }) => type === "run_budget_cancel_failed"),
  );

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  for await (const event of executeRun(
    { runId: retryRun.id },
    { startRunner: reconnectingRunner, cancelRunner: retryingCancel },
  ))
    void event;
  assert.equal(runnerStarts, 2);
  assert.equal(cancellationAttempts, 2);
  assert.equal(runRepository.getRun(retryRun.id)?.status, "cancelled");
  assert.equal(budget.getRunBudget(retryRun.id)?.terminalStatus, "cancelled");

  settingsRepository.set("runner_url", "http://runner.test");
  const compatibilityCalls = [];
  const oldRunnerFetcher = async (url) => {
    compatibilityCalls.push(String(url));
    if (String(url).endsWith("/attach")) {
      return Response.json(
        { error: { message: "Run not found" } },
        { status: 404 },
      );
    }
    if (String(url).endsWith("/runtimes")) {
      return Response.json({
        data: [
          {
            id: "claude",
            displayName: "Claude Agent",
            stability: "experimental",
            authModes: ["api_key"],
            capabilities: { usageReporting: true },
            available: true,
            status: "available",
            reasonCode: "ready",
            authentication: { status: "authenticated", mode: "api_key" },
            checkedAt: new Date().toISOString(),
          },
        ],
      });
    }
    throw new Error(`Unexpected Runner request: ${url}`);
  };
  await assert.rejects(
    () =>
      startRunnerRun(
        {
          runId: "mixed-version-budget-run",
          agent: { ...agent, runtime: "claude", model: "default" },
          thread,
          messages: [],
          prompt: "Do not run without a native cost ceiling.",
          execution: {
            trigger: "manual",
            mode: "task",
            issueKey: null,
            policy: "Complete the task within budget.",
          },
          budget: {
            maxTokens: null,
            maxCostUsd: 1,
            pricing: null,
          },
        },
        { fetcher: oldRunnerFetcher },
      ),
    /does not advertise the budget enforcement/,
  );
  assert.deepEqual(compatibilityCalls, [
    "http://runner.test/runs/mixed-version-budget-run/attach",
    "http://runner.test/runtimes",
  ]);

  const compatibilityConfiguration = budget.getBudgetConfiguration();
  budget.updateBudgetConfiguration({
    expectedVersion: compatibilityConfiguration.workspace.version,
    workspace: {
      maxTokensPerRun: null,
      maxCostUsdPerRun: 5,
      dailyCostUsd: 5,
      monthlyCostUsd: null,
    },
    agents: [],
    prices: [
      {
        runtimeId: "codex",
        model: "default",
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0,
        outputUsdPerMillion: 1,
      },
    ],
  });
  const compatibilityRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Fail before Runner creation without consuming daily exposure.",
  });
  compatibilityCalls.length = 0;
  for await (const event of executeRun(
    { runId: compatibilityRun.id },
    {
      startRunner: (input) =>
        startRunnerRun(input, { fetcher: oldRunnerFetcher }),
    },
  )) {
    void event;
  }
  assert.equal(runRepository.getRun(compatibilityRun.id)?.status, "failed");
  assert.equal(budget.getRunBudget(compatibilityRun.id)?.actualCostUsd, 0);
  assert.equal(budget.getRunBudget(compatibilityRun.id)?.status, "settled");
  assert.ok(
    runRepository
      .listRunEvents(compatibilityRun.id)
      .some(
        ({ type, payload }) =>
          type === "run_failed" &&
          payload.phase === "runner_budget_compatibility" &&
          payload.runtimeStarted === false,
      ),
  );
  assert.ok(
    !compatibilityCalls.some((url) => url === "http://runner.test/runs"),
  );

  const afterCompatibilityFailure = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "The released daily budget remains available.",
  });
  assert.equal(
    budget.admitRunBudget(afterCompatibilityFailure, agent).allowed,
    true,
  );
  runRepository.updateRun(afterCompatibilityFailure.id, "cancelled");
  budget.releaseRunBudgetWithoutRuntime(
    afterCompatibilityFailure.id,
    "cancelled",
  );

  const catalogFailureCalls = [];
  const catalogFailureFetcher = async (url) => {
    catalogFailureCalls.push(String(url));
    if (String(url).endsWith("/attach")) {
      return Response.json(
        { error: { message: "Run not found" } },
        { status: 404 },
      );
    }
    if (String(url).endsWith("/runtimes")) {
      return Response.json(
        { error: { message: "Runtime catalog unavailable" } },
        { status: 500 },
      );
    }
    throw new Error(`Unexpected Runner request: ${url}`);
  };
  const catalogFailureRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Fail closed when the Runner catalog is unavailable.",
  });
  for await (const event of executeRun(
    { runId: catalogFailureRun.id },
    {
      startRunner: (input) =>
        startRunnerRun(input, { fetcher: catalogFailureFetcher }),
    },
  )) {
    void event;
  }
  assert.equal(runRepository.getRun(catalogFailureRun.id)?.status, "failed");
  assert.equal(budget.getRunBudget(catalogFailureRun.id)?.actualCostUsd, 0);
  assert.deepEqual(catalogFailureCalls, [
    `${settingsRepository.get("runner_url")}/runs/${catalogFailureRun.id}/attach`,
    `${settingsRepository.get("runner_url")}/runtimes`,
  ]);

  const afterCatalogFailure = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Catalog failure also released the daily budget.",
  });
  assert.equal(budget.admitRunBudget(afterCatalogFailure, agent).allowed, true);
});
