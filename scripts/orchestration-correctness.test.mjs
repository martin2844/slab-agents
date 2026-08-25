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
let agentRepository;
let conversationRepository;
let runRepository;

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
  ({ agentRepository } =
    await import("../lib/repositories/agent-repository.ts"));
  ({ conversationRepository } =
    await import("../lib/repositories/conversation-repository.ts"));
  ({ runRepository } = await import("../lib/repositories/run-repository.ts"));
  modules = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/run-service.ts"),
    import("../lib/work-coordination.ts"),
    import("../lib/db/database.ts"),
    import("../lib/repositories/approval-repository.ts"),
    import("../lib/approval-resolution.ts"),
    import("../lib/repositories/work-coordination-repository.ts"),
  ]);
});

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

function createAgent(_repository, slug = "coo") {
  return agentRepository.createAgent({
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
  const [{ repository }, { createRunExecution }, { triggerAgent }] = modules;
  const agent = createAgent(repository);
  const thread = conversationRepository.getOrCreateWorkAgentThread(
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
  runRepository.updateRun(active.id, "running");

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

  const runs = runRepository
    .listRuns()
    .filter((run) => run.threadId === thread.id);
  assert.equal(runs.length, 2);
  assert.equal(runs.find((run) => run.id !== active.id)?.status, "queued");
  assert.equal(dispatched.length, 1);
});

test("approval completion never overwrites terminal state or bypasses another approval", async () => {
  const [{ repository }, { createRunExecution }, , , { approvalRepository }] =
    modules;
  const agent = createAgent(repository, "sales");
  const thread = conversationRepository.createThread(
    agent.id,
    "Approval lifecycle",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Run with approvals",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const first = approvalRepository.create(run.id, "approval-1", "First", {});
  approvalRepository.create(run.id, "approval-2", "Second", {});

  approvalRepository.claim(first.id);
  approvalRepository.resolve(first.id, "approved");
  assert.equal(runRepository.resumeWhenApprovalsClear(run.id), false);
  assert.equal(runRepository.getRun(run.id)?.status, "waiting_approval");

  const second = approvalRepository
    .listForRun(run.id)
    .find((approval) => approval.runnerApprovalId === "approval-2");
  assert.ok(second);
  approvalRepository.claim(second.id);
  approvalRepository.resolve(second.id, "approved");
  runRepository.updateRun(run.id, "completed");
  assert.equal(runRepository.resumeWhenApprovalsClear(run.id), false);
  assert.equal(runRepository.getRun(run.id)?.status, "completed");
  assert.ok(runRepository.getRun(run.id)?.completedAt);
});

test("the server refuses an Email send approval without a verified sender", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    ,
    { approvalRepository },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "email-approval-guard");
  const thread = conversationRepository.createThread(
    agent.id,
    "Email approval guard",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Send an email",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(
    run.id,
    "email-without-sender",
    "Allow email_send?",
    {
      server: "email",
      message: 'Allow the email MCP server to run tool "email_send"?',
    },
  );

  await assert.rejects(
    resolveApprovalAction(approval.id, "approve", {
      resolveRunner: async () => assert.fail("Runner must not be called"),
      runnerRunNotFound: () => false,
    }),
    (error) => error?.code === "EMAIL_APPROVAL_INCOMPLETE",
  );
  assert.equal(approvalRepository.get(approval.id)?.status, "pending");
});

test("a missing Runner run dismisses every stale approval and cancels the local run", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    ,
    { approvalRepository },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "stale-approval");
  const thread = conversationRepository.createThread(
    agent.id,
    "Stale approvals",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Run whose Runner state disappeared",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const first = approvalRepository.create(run.id, "missing-1", "First", {});
  approvalRepository.create(run.id, "missing-2", "Second", {});

  const result = await resolveApprovalAction(first.id, "approve", {
    resolveRunner: async () => {
      throw new Error("missing runner run");
    },
    runnerRunNotFound: () => true,
  });

  assert.equal(result.dismissed, true);
  assert.equal(runRepository.getRun(run.id)?.status, "cancelled");
  assert.deepEqual(
    approvalRepository.listForRun(run.id).map((approval) => approval.status),
    ["denied", "denied"],
  );
  assert.equal(
    runRepository
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
    { approvalRepository },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "terminal-approval");
  const thread = conversationRepository.createThread(
    agent.id,
    "Terminal approval",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Already finished",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(
    run.id,
    "late",
    "Late approval",
    {},
  );
  runRepository.updateRun(run.id, "completed");
  let runnerCalls = 0;
  const runCount = runRepository.listRuns().length;

  const result = await resolveApprovalAction(approval.id, "approve", {
    resolveRunner: async () => {
      runnerCalls += 1;
      return {};
    },
    runnerRunNotFound: () => false,
  });

  assert.equal(result.dismissed, true);
  assert.equal(runnerCalls, 0);
  assert.equal(runRepository.listRuns().length, runCount);
  assert.equal(runRepository.getRun(run.id)?.status, "completed");
  assert.equal(approvalRepository.get(approval.id)?.status, "denied");
});

test("a locally failed approval finalization never resends an accepted Runner decision", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    ,
    { approvalRepository },
    { resolveApprovalAction },
  ] = modules;
  const agent = createAgent(repository, "approval-recovery");
  const thread = conversationRepository.createThread(
    agent.id,
    "Approval recovery",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover local finalization",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(run.id, "recover", "Recover", {});
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
  assert.equal(approvalRepository.get(approval.id)?.status, "resolving");
  assert.equal(
    approvalRepository.get(approval.id)?.details.runnerDecision,
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
  runRepository.updateRun(markerRun.id, "waiting_approval");
  const markerApproval = approvalRepository.create(
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
  assert.equal(approvalRepository.get(markerApproval.id)?.status, "resolving");
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
  runRepository.updateRun(terminalRun.id, "waiting_approval");
  const terminalApproval = approvalRepository.create(
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
        approvalRepository.closePending(terminalRun.id);
        return {};
      },
      runnerRunNotFound: () => false,
    },
  );
  assert.equal(terminalResult.status, "approved");
  assert.equal(approvalRepository.get(terminalApproval.id)?.status, "approved");
});

test("a failed issue inspection leaves state unobserved so the next poll retries", async () => {
  const [
    { repository },
    ,
    { inspectIssue },
    ,
    ,
    ,
    { workCoordinationRepository },
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
  assert.equal(workCoordinationRepository.getItem(issue.key), undefined);

  const dispatched = [];
  await inspectIssue("OPS", issue, [agent], {
    dispatch: async (input) => {
      dispatched.push(input.dedupeKey);
    },
    listComments: async () => [],
  });
  assert.equal(dispatched.length, 1);
  assert.equal(
    workCoordinationRepository.getItem(issue.key)?.assignee,
    agent.slug,
  );
});

test("a stale incomplete coordination claim is recoverable after a crash", async () => {
  const [
    { repository },
    ,
    { triggerAgent },
    { db },
    ,
    ,
    { workCoordinationRepository },
  ] = modules;
  const agent = createAgent(repository, "stale-claim");
  const dedupeKey = "assignment:OPS-STALE:v1";
  workCoordinationRepository.claimEvent({
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
  const thread = conversationRepository.createThread(
    agent.id,
    "Atomic creation",
  );
  const before = runRepository.listRuns().length;
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
  assert.equal(runRepository.listRuns().length, before);
  db.exec("DROP TRIGGER reject_test_message");
});

test("abandoned-run recovery closes resolving approvals", async () => {
  const [{ repository }, { createRunExecution }, , , { approvalRepository }] =
    modules;
  const { recoverRunDispatch } = await import("../lib/run-dispatcher.ts");
  const agent = createAgent(repository, "recovery-approval");
  const thread = conversationRepository.createThread(
    agent.id,
    "Recovery approval",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover abandoned approval",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(
    run.id,
    "abandoned",
    "Abandoned",
    {},
  );
  assert.ok(approvalRepository.claim(approval.id));

  recoverRunDispatch({
    recoverExpired: () => ({
      requeued: [],
      failed: [run.id],
      releasedQueued: [],
    }),
  });
  assert.equal(approvalRepository.get(approval.id)?.status, "denied");
});

test("requeued approval recovery never leaves a resolving zombie", async () => {
  const [{ repository }, { createRunExecution }, , , { approvalRepository }] =
    modules;
  const { recoverRunDispatch } = await import("../lib/run-dispatcher.ts");
  const agent = createAgent(repository, "requeued-approval");
  const thread = conversationRepository.createThread(
    agent.id,
    "Requeued approval",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover ambiguous approval",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(
    run.id,
    "ambiguous",
    "Ambiguous",
    {},
  );
  assert.ok(approvalRepository.claim(approval.id));
  runRepository.updateRun(run.id, "queued");

  recoverRunDispatch({
    recoverExpired: () => ({
      requeued: [run.id],
      failed: [],
      releasedQueued: [],
    }),
  });

  assert.equal(runRepository.getRun(run.id)?.status, "failed");
  assert.equal(approvalRepository.get(approval.id)?.status, "denied");
  assert.equal(
    runRepository
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
  runRepository.updateRun(recordedRun.id, "waiting_approval");
  const recordedApproval = approvalRepository.create(
    recordedRun.id,
    "recorded",
    "Recorded",
    {},
  );
  assert.ok(approvalRepository.claim(recordedApproval.id));
  assert.equal(
    approvalRepository.recordRunnerDecision(recordedApproval.id, "approve"),
    true,
  );
  runRepository.updateRun(recordedRun.id, "queued");
  recoverRunDispatch({
    recoverExpired: () => ({
      requeued: [recordedRun.id],
      failed: [],
      releasedQueued: [],
    }),
  });
  assert.equal(runRepository.getRun(recordedRun.id)?.status, "queued");
  assert.equal(approvalRepository.get(recordedApproval.id)?.status, "approved");
});

test("recovery rolls back queue and approval changes when audit persistence fails", async () => {
  const [
    { repository },
    { createRunExecution },
    ,
    { db },
    { approvalRepository },
  ] = modules;
  const { recoverRunDispatch } = await import("../lib/run-dispatcher.ts");
  const agent = createAgent(repository, "atomic-recovery");
  const thread = conversationRepository.createThread(
    agent.id,
    "Atomic recovery",
  );
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Recover atomically",
  });
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(
    run.id,
    "atomic-recovery",
    "Atomic recovery",
    {},
  );
  assert.ok(approvalRepository.claim(approval.id));

  db.exec(`CREATE TRIGGER reject_recovery_audit
    BEFORE INSERT ON run_events
    WHEN NEW.type = 'run_recovery_failed'
    BEGIN SELECT RAISE(ABORT, 'recovery audit rejected'); END`);
  try {
    assert.throws(
      () =>
        recoverRunDispatch({
          recoverExpired: () => {
            runRepository.updateRun(run.id, "queued");
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

  assert.equal(runRepository.getRun(run.id)?.status, "waiting_approval");
  assert.equal(approvalRepository.get(approval.id)?.status, "resolving");
});
