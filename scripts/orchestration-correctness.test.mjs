import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

let directory;
let modules;

test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "slab-correctness-"));
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
  modules = await Promise.all([
    import("../lib/repository.ts"),
    import("../lib/run-service.ts"),
    import("../lib/work-coordination.ts"),
    import("../lib/db.ts"),
    import("../lib/repositories/approval-store.ts"),
    import("../lib/approval-resolution.ts"),
    import("../lib/repositories/work-coordination-store.ts"),
  ]);
});

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function createAgent(repository, slug = "coo") {
  return repository.createAgent({
    name: slug.toUpperCase(),
    slug,
    role: "Operations",
    instructions: "Operate",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
}

test("state-triggered work is queued while an earlier thread run is active", async () => {
  const [{ repository }, { createRunExecution }, { triggerAgent }] =
    modules;
  const agent = createAgent(repository);
  const thread = repository.getOrCreateWorkAgentThread(
    "OPS-1",
    agent.id,
    "OPS-1 · Existing work",
  );
  const active = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "assignment",
    mode: "assignment",
    issueKey: "OPS-1",
    prompt: "Existing assignment",
  });
  repository.updateRun(active.id, "running");

  const dispatched = [];
  await triggerAgent(
    {
      type: "blocked",
      agent,
      dedupeKey: "blocked:OPS-1:v2",
      issue: {
        id: "issue-1",
        key: "OPS-1",
        title: "Existing work",
        description: "",
        type: "task",
        status: "blocked",
        priority: "high",
        assignee: "sales",
        labels: ["status:blocked"],
        version: 2,
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:01:00.000Z",
      },
    },
    async (runId) => {
      dispatched.push(runId);
    },
  );

  await triggerAgent(
    {
      type: "blocked",
      agent,
      dedupeKey: "blocked:OPS-1:v2",
      issue: {
        id: "issue-1",
        key: "OPS-1",
        title: "Existing work",
        description: "",
        type: "task",
        status: "blocked",
        priority: "high",
        assignee: "sales",
        labels: ["status:blocked"],
        version: 2,
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:01:00.000Z",
      },
    },
    async (runId) => {
      dispatched.push(runId);
    },
  );

  const runs = repository.listRuns().filter((run) => run.threadId === thread.id);
  assert.equal(runs.length, 2);
  assert.equal(runs.find((run) => run.id !== active.id)?.status, "queued");
  assert.equal(dispatched.length, 1);
});

test("approval completion never overwrites terminal state or bypasses another approval", async () => {
  const [{ repository }, { createRunExecution }, , , { approvalStore }] = modules;
  const agent = createAgent(repository, "sales");
  const thread = repository.createThread(agent.id, "Approval lifecycle");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Run with approvals",
  });
  repository.updateRun(run.id, "waiting_approval");
  const first = approvalStore.create(run.id, "approval-1", "First", {});
  approvalStore.create(run.id, "approval-2", "Second", {});

  approvalStore.claim(first.id);
  approvalStore.resolve(first.id, "approved");
  assert.equal(approvalStore.resumeRunWhenClear(run.id), false);
  assert.equal(repository.getRun(run.id)?.status, "waiting_approval");

  const second = approvalStore
    .listForRun(run.id)
    .find((approval) => approval.runnerApprovalId === "approval-2");
  assert.ok(second);
  approvalStore.claim(second.id);
  approvalStore.resolve(second.id, "approved");
  repository.updateRun(run.id, "completed");
  assert.equal(approvalStore.resumeRunWhenClear(run.id), false);
  assert.equal(repository.getRun(run.id)?.status, "completed");
  assert.ok(repository.getRun(run.id)?.completedAt);
});

test("a missing Runner run dismisses every stale approval and cancels the local run", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    ,
    { approvalStore },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "stale-approval");
  const thread = repository.createThread(agent.id, "Stale approvals");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Run whose Runner state disappeared",
  });
  repository.updateRun(run.id, "waiting_approval");
  const first = approvalStore.create(run.id, "missing-1", "First", {});
  approvalStore.create(run.id, "missing-2", "Second", {});

  const result = await resolveApprovalAction(first.id, "approve", {
    resolveRunner: async () => {
      throw new Error("missing runner run");
    },
    runnerRunNotFound: () => true,
  });

  assert.equal(result.dismissed, true);
  assert.equal(repository.getRun(run.id)?.status, "cancelled");
  assert.deepEqual(
    approvalStore.listForRun(run.id).map((approval) => approval.status),
    ["denied", "denied"],
  );
  assert.equal(
    repository
      .listRunEvents(run.id)
      .some((event) => event.type === "approval_dismissed"),
    true,
  );

});

test("resolving a stale approval never rewrites an already terminal run", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    ,
    { approvalStore },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "terminal-approval");
  const thread = repository.createThread(agent.id, "Terminal approval");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Already finished",
  });
  repository.updateRun(run.id, "waiting_approval");
  const approval = approvalStore.create(run.id, "late", "Late approval", {});
  repository.updateRun(run.id, "completed");
  let runnerCalls = 0;
  const runCount = repository.listRuns().length;

  const result = await resolveApprovalAction(approval.id, "approve", {
    resolveRunner: async () => {
      runnerCalls += 1;
      return {};
    },
    runnerRunNotFound: () => false,
  });

  assert.equal(result.dismissed, true);
  assert.equal(runnerCalls, 0);
  assert.equal(repository.listRuns().length, runCount);
  assert.equal(repository.getRun(run.id)?.status, "completed");
  assert.equal(approvalStore.get(approval.id)?.status, "denied");
});

test("a locally failed approval finalization never resends an accepted Runner decision", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    ,
    { approvalStore },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "approval-recovery");
  const thread = repository.createThread(agent.id, "Approval recovery");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover local finalization",
  });
  repository.updateRun(run.id, "waiting_approval");
  const approval = approvalStore.create(run.id, "recover", "Recover", {});
  let runnerCalls = 0;

  await assert.rejects(
    resolveApprovalAction(approval.id, "approve", {
      resolveRunner: async () => {
        runnerCalls += 1;
        return {};
      },
      runnerRunNotFound: () => false,
      finalizeLocal: () => {
        throw new Error("simulated SQLite finalization failure");
      },
    }),
    /simulated SQLite/,
  );
  assert.equal(approvalStore.get(approval.id)?.status, "resolving");
  assert.equal(
    approvalStore.get(approval.id)?.details.runnerDecision,
    "approve",
  );

  const resolved = await resolveApprovalAction(approval.id, "approve", {
    resolveRunner: async () => {
      runnerCalls += 1;
      return {};
    },
    runnerRunNotFound: () => false,
  });
  assert.equal(resolved.status, "approved");
  assert.equal(runnerCalls, 1);

  const markerRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Fail marker persistence",
  });
  repository.updateRun(markerRun.id, "waiting_approval");
  const markerApproval = approvalStore.create(
    markerRun.id,
    "marker-failure",
    "Marker failure",
    {},
  );
  await assert.rejects(
    resolveApprovalAction(markerApproval.id, "approve", {
      resolveRunner: async () => {
        runnerCalls += 1;
        return {};
      },
      runnerRunNotFound: () => false,
      recordRunnerDecision: () => false,
    }),
    /Could not record Runner approval resolution/,
  );
  assert.equal(approvalStore.get(markerApproval.id)?.status, "resolving");
  await assert.rejects(
    resolveApprovalAction(markerApproval.id, "approve", {
      resolveRunner: async () => {
        runnerCalls += 1;
        return {};
      },
      runnerRunNotFound: () => false,
    }),
    /already being resolved/,
  );
  assert.equal(runnerCalls, 2);

  const terminalRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Terminal cleanup race",
  });
  repository.updateRun(terminalRun.id, "waiting_approval");
  const terminalApproval = approvalStore.create(
    terminalRun.id,
    "terminal-race",
    "Terminal race",
    {},
  );
  const terminalResult = await resolveApprovalAction(
    terminalApproval.id,
    "approve",
    {
      resolveRunner: async () => {
        approvalStore.closePending(terminalRun.id);
        return {};
      },
      runnerRunNotFound: () => false,
    },
  );
  assert.equal(terminalResult.status, "approved");
  assert.equal(approvalStore.get(terminalApproval.id)?.status, "approved");
});

test("a failed issue inspection leaves state unobserved so the next poll retries", async () => {
  const [
    { repository },
    ,
    { inspectIssue },
    ,
    ,
    ,
    { workCoordinationStore },
  ] = modules;
  const agent = createAgent(repository, "retry-event");
  const issue = {
    id: "issue-retry",
    key: "OPS-RETRY",
    title: "Retry coordination",
    description: "",
    type: "task",
    status: "new",
    priority: "normal",
    assignee: agent.slug,
    labels: [],
    version: 1,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  };
  await assert.rejects(
    inspectIssue("OPS", issue, [agent], {
      dispatch: async () => {
        throw new Error("run rejected once");
      },
      listComments: async () => [],
    }),
    /run rejected once/,
  );
  assert.equal(workCoordinationStore.getItem(issue.key), undefined);

  const dispatched = [];
  await inspectIssue("OPS", issue, [agent], {
    dispatch: async (input) => {
      dispatched.push(input.dedupeKey);
    },
    listComments: async () => [],
  });
  assert.equal(dispatched.length, 1);
  assert.equal(workCoordinationStore.getItem(issue.key)?.assignee, agent.slug);
});

test("a stale incomplete coordination claim is recoverable after a crash", async () => {
  const [
    { repository },
    ,
    { triggerAgent },
    { db },
    ,
    ,
    { workCoordinationStore },
  ] = modules;
  const agent = createAgent(repository, "stale-claim");
  const dedupeKey = "assignment:OPS-STALE:v1";
  workCoordinationStore.claimEvent({
    dedupeKey,
    issueKey: "OPS-STALE",
    type: "assignment",
    agentId: agent.id,
  });
  db.prepare(
    "UPDATE work_coordination_events SET updated_at=? WHERE dedupe_key=?",
  ).run("2020-01-01T00:00:00.000Z", dedupeKey);
  const dispatched = [];

  await triggerAgent(
    {
      type: "assignment",
      agent,
      dedupeKey,
      issue: {
        id: "issue-stale",
        key: "OPS-STALE",
        title: "Recover stale claim",
        description: "",
        type: "task",
        status: "new",
        priority: "normal",
        assignee: agent.slug,
        labels: [],
        version: 1,
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:00:00.000Z",
      },
    },
    async (runId) => {
      dispatched.push(runId);
    },
  );

  assert.equal(dispatched.length, 1);
});

test("run creation rolls back when any invariant write fails", async () => {
  const [{ repository }, { createRunExecution }, , { db }] = modules;
  const agent = createAgent(repository, "atomic");
  const thread = repository.createThread(agent.id, "Atomic creation");
  const before = repository.listRuns().length;
  db.exec(`CREATE TRIGGER reject_test_message
    BEFORE INSERT ON messages
    BEGIN SELECT RAISE(ABORT, 'message rejected'); END`);

  assert.throws(
    () =>
      createRunExecution({
        agentId: agent.id,
        threadId: thread.id,
        trigger: "manual",
        mode: "task",
        prompt: "Must roll back",
      }),
    /message rejected/,
  );
  assert.equal(repository.listRuns().length, before);
  db.exec("DROP TRIGGER reject_test_message");
});

test("abandoned-run recovery closes resolving approvals", async () => {
  const [{ repository }, { createRunExecution }, , , { approvalStore }] = modules;
  const { recoverRunDispatch } = await import("../lib/run-dispatcher.ts");
  const agent = createAgent(repository, "recovery-approval");
  const thread = repository.createThread(agent.id, "Recovery approval");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover abandoned approval",
  });
  repository.updateRun(run.id, "waiting_approval");
  const approval = approvalStore.create(run.id, "abandoned", "Abandoned", {});
  assert.ok(approvalStore.claim(approval.id));

  recoverRunDispatch({
    recoverExpired: () => ({
      requeued: [],
      failed: [run.id],
      releasedQueued: [],
    }),
  });
  assert.equal(approvalStore.get(approval.id)?.status, "denied");
});

test("requeued approval recovery never leaves a resolving zombie", async () => {
  const [{ repository }, { createRunExecution }, , , { approvalStore }] = modules;
  const { recoverRunDispatch } = await import("../lib/run-dispatcher.ts");
  const agent = createAgent(repository, "requeued-approval");
  const thread = repository.createThread(agent.id, "Requeued approval");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover ambiguous approval",
  });
  repository.updateRun(run.id, "waiting_approval");
  const approval = approvalStore.create(run.id, "ambiguous", "Ambiguous", {});
  assert.ok(approvalStore.claim(approval.id));
  repository.updateRun(run.id, "queued");

  recoverRunDispatch({
    recoverExpired: () => ({
      requeued: [run.id],
      failed: [],
      releasedQueued: [],
    }),
  });

  assert.equal(repository.getRun(run.id)?.status, "failed");
  assert.equal(approvalStore.get(approval.id)?.status, "denied");
  assert.equal(
    repository
      .listRunEvents(run.id)
      .some(
        (event) =>
          event.type === "run_recovery_failed" &&
          event.payload.reason === "ambiguous_approval_resolution",
      ),
    true,
  );

  const recordedRun = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover recorded approval",
  });
  repository.updateRun(recordedRun.id, "waiting_approval");
  const recordedApproval = approvalStore.create(
    recordedRun.id,
    "recorded",
    "Recorded",
    {},
  );
  assert.ok(approvalStore.claim(recordedApproval.id));
  assert.equal(
    approvalStore.recordRunnerDecision(recordedApproval.id, "approve"),
    true,
  );
  repository.updateRun(recordedRun.id, "queued");
  recoverRunDispatch({
    recoverExpired: () => ({
      requeued: [recordedRun.id],
      failed: [],
      releasedQueued: [],
    }),
  });
  assert.equal(repository.getRun(recordedRun.id)?.status, "queued");
  assert.equal(approvalStore.get(recordedApproval.id)?.status, "approved");
});

test("recovery rolls back queue and approval changes when audit persistence fails", async () => {
  const [{ repository }, { createRunExecution }, , { db }, { approvalStore }] =
    modules;
  const { recoverRunDispatch } = await import("../lib/run-dispatcher.ts");
  const agent = createAgent(repository, "atomic-recovery");
  const thread = repository.createThread(agent.id, "Atomic recovery");
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover atomically",
  });
  repository.updateRun(run.id, "waiting_approval");
  const approval = approvalStore.create(
    run.id,
    "atomic-recovery",
    "Atomic recovery",
    {},
  );
  assert.ok(approvalStore.claim(approval.id));

  db.exec(`CREATE TRIGGER reject_recovery_audit
    BEFORE INSERT ON run_events
    WHEN NEW.type = 'run_recovery_failed'
    BEGIN SELECT RAISE(ABORT, 'recovery audit rejected'); END`);
  try {
    assert.throws(
      () =>
        recoverRunDispatch({
          recoverExpired: () => {
            repository.updateRun(run.id, "queued");
            return {
              requeued: [run.id],
              failed: [],
              releasedQueued: [],
            };
          },
        }),
      /recovery audit rejected/,
    );
  } finally {
    db.exec("DROP TRIGGER reject_recovery_audit");
  }

  assert.equal(repository.getRun(run.id)?.status, "waiting_approval");
  assert.equal(approvalStore.get(approval.id)?.status, "resolving");
});
