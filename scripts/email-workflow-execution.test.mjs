import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

const migrationDirectory = path.resolve("db/migrations");

test("inbound email workflows hand off durably and serialize a conversation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-email-workflow-"));
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
    { db },
    { automationRepository },
    { automationExecutionRepository },
    { conversationRepository },
    { runRepository },
    { agentRepository },
    { startEmailAutomationRun, advanceEmailWorkflowExecutions },
    { storeEmailConnectorToken },
    { snapshotAgentToolPolicies, filterToolsByRunPolicy },
  ] = await Promise.all([
    import("../lib/db/database.ts"),
    import("../lib/repositories/automation-repository.ts"),
    import("../lib/repositories/automation-execution-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/email-workflow-execution-service.ts"),
    import("../lib/integrations/email-token-vault.ts"),
    import("../lib/agent-tool-policy.ts"),
  ]);
  t.after(() => db.close());

  const timestamp = "2026-08-28T10:00:00.000Z";
  const writerId = "11111111-1111-4111-8111-111111111111";
  const reviewerId = "22222222-2222-4222-8222-222222222222";
  const insertAgent = db.prepare(
    `INSERT INTO agents
     (id,name,slug,role,instructions,runtime,model,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  insertAgent.run(
    writerId,
    "Clara",
    "clara-workflow-test",
    "Sales",
    "Write clear replies.",
    "codex",
    "default",
    1,
    timestamp,
    timestamp,
  );
  insertAgent.run(
    reviewerId,
    "COO",
    "coo-workflow-test",
    "Operations",
    "Review decisions.",
    "codex",
    "default",
    1,
    timestamp,
    timestamp,
  );
  const insertAccess = db.prepare(
    `INSERT INTO agent_email_access
     (agent_id,profile_id,profile_name,read_enabled,draft_enabled,send_enabled,send_policy,token_id,token_prefix,token_created_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  insertAccess.run(
    writerId,
    "writer-profile",
    "Writer",
    1,
    1,
    0,
    "disabled",
    "writer-token",
    "writer",
    timestamp,
    timestamp,
    timestamp,
  );
  insertAccess.run(
    reviewerId,
    "reviewer-profile",
    "Reviewer",
    1,
    1,
    1,
    "approval_required",
    "reviewer-token",
    "reviewer",
    timestamp,
    timestamp,
    timestamp,
  );
  db.prepare(
    "INSERT INTO agent_email_accounts (agent_id,account_id) VALUES (?,?)",
  ).run(writerId, "account-1");
  db.prepare(
    "INSERT INTO agent_email_accounts (agent_id,account_id) VALUES (?,?)",
  ).run(reviewerId, "account-1");
  db.prepare(
    `INSERT INTO email_integrations
     (id,service_url,status,last_tested_at,last_error,created_at,updated_at)
     VALUES ('email',?,'connected',?,NULL,?,?)`,
  ).run("http://127.0.0.1:6981", timestamp, timestamp, timestamp);
  storeEmailConnectorToken("writer-token", "writer-secret");
  storeEmailConnectorToken("reviewer-token", "reviewer-secret");

  const originalSteps = [
    {
      id: "draft",
      type: "agent_task",
      agentId: writerId,
      action: "draft_reply",
      prompt: "Draft a factual support reply.",
    },
    {
      id: "review",
      type: "agent_review",
      agentId: reviewerId,
      action: "review_and_reply",
      prompt: "Review the draft and reply if it is safe.",
    },
  ];
  const automation = automationRepository.createAutomation({
    name: "Support reply workflow",
    agentId: writerId,
    triggerType: "email",
    cronExpression: null,
    emailAccountId: "account-1",
    prompt: originalSteps[0].prompt,
    mode: "task",
    enabled: true,
    steps: originalSteps,
  });
  const discoveredAt = new Date(
    Date.parse(automation.createdAt) + 60_000,
  ).toISOString();
  const event = (id) => ({
    id,
    accountId: "account-1",
    provider: "gmail",
    messageId: `message-${id}`,
    threadId: "shared-thread",
    from: { address: "customer@example.com" },
    to: [{ address: "support@example.com" }],
    subject: `Help ${id}`,
    receivedAt: discoveredAt,
    discoveredAt,
  });
  assert.equal(
    automationRepository.recordEmailEventPage({
      expectedCursor: 0,
      events: [event(1), event(2)],
      complete: false,
    }),
    true,
  );
  const account = {
    id: "account-1",
    capabilities: { read: true, draft: true, send: true, reply: true },
  };
  const startedRuns = [];
  const dependencies = {
    getAccount: async () => account,
    executeInBackground: (runId) => startedRuns.push(runId),
  };

  const first = await startEmailAutomationRun(automation.id, 1, dependencies);
  assert.equal(first.status, "dispatched");
  assert.equal(startedRuns.length, 1);
  const occurrence = automationRepository.getEmailOccurrence(automation.id, 1);
  assert.ok(occurrence?.executionId);
  const execution = automationExecutionRepository.getExecution(
    occurrence.executionId,
  );
  assert.equal(execution?.definitionVersion, 1);
  assert.equal(execution?.definition.mode, "task");
  assert.deepEqual(execution?.definition.steps, originalSteps);
  db.prepare("UPDATE automation_executions SET definition_json=? WHERE id=?").run(
    JSON.stringify({
      ...execution.definition,
      steps: execution.definition.steps.map((step) => ({
        ...step,
        type: "agent_task",
      })),
    }),
    execution.id,
  );
  assert.equal(
    automationExecutionRepository.getExecution(execution.id).definition.steps[1]
      .type,
    "agent_review",
  );
  const executionSteps = automationExecutionRepository.listSteps(execution.id);
  assert.equal(executionSteps[0].runId, occurrence.runId);
  assert.equal(executionSteps[1].runId, null);
  assert.equal(executionSteps[0].status, "running");
  const recentExecutions = automationExecutionRepository.listRecentWithSteps();
  assert.equal(recentExecutions[0].id, execution.id);
  assert.deepEqual(
    recentExecutions[0].steps.map(({ stepId }) => stepId),
    originalSteps.map(({ id }) => id),
  );

  const draftEvents = runRepository.listRunEvents(occurrence.runId);
  const constraints = draftEvents.find(
    ({ type }) => type === "automation_tool_policy_constraints",
  );
  assert.ok(constraints);
  const writer = agentRepository.getAgent(writerId);
  snapshotAgentToolPolicies({
    runId: occurrence.runId,
    agent: writer,
    servers: [
      {
        name: "email",
        url: "http://email.test/mcp",
        approval: { defaultMode: "approve", tools: {} },
      },
    ],
    overrides: constraints.payload.overrides,
  });
  assert.deepEqual(
    filterToolsByRunPolicy(occurrence.runId, "email", [
      "email_search",
      "email_create_draft",
      "email_reply",
      "email_send",
    ]),
    ["email_search"],
  );

  const deferred = await startEmailAutomationRun(automation.id, 2, dependencies);
  assert.equal(deferred.status, "deferred");
  assert.equal(
    automationRepository.getEmailOccurrence(automation.id, 2)?.status,
    "pending",
  );

  automationRepository.updateAutomation(automation.id, {
    steps: [
      originalSteps[0],
      { ...originalSteps[1], prompt: "A changed future definition." },
    ],
  });
  const firstRun = runRepository.getRun(occurrence.runId);
  conversationRepository.addRunMessageOnce(
    firstRun.threadId,
    firstRun.id,
    "assistant",
    "Subject: Re: Help\n\nHere is the reviewed factual draft.",
  );
  runRepository.updateRun(firstRun.id, "completed");
  const transientErrors = [];
  await advanceEmailWorkflowExecutions({
    ...dependencies,
    getAccount: async () => {
      throw new Error("temporary account lookup failure");
    },
    logError: (message, error) => transientErrors.push({ message, error }),
  });
  assert.equal(transientErrors.length, 1);
  assert.equal(
    automationExecutionRepository.listSteps(execution.id)[1].runId,
    null,
  );
  await advanceEmailWorkflowExecutions(dependencies);

  const afterHandoff = automationExecutionRepository.listSteps(execution.id);
  const reviewRun = runRepository.getRun(afterHandoff[1].runId);
  assert.ok(reviewRun);
  assert.notEqual(reviewRun.threadId, firstRun.threadId);
  assert.equal(startedRuns.length, 2);
  const reviewInput = conversationRepository.getRunInput(reviewRun.id)?.body;
  assert.match(reviewInput, /Here is the reviewed factual draft/);
  assert.match(reviewInput, /Review the draft and reply if it is safe/);
  assert.doesNotMatch(reviewInput, /changed future definition/);
  assert.equal(
    runRepository
      .listRunEvents(reviewRun.id)
      .some(({ type }) => type === "automation_tool_policy_constraints"),
    false,
  );
  assert.equal(
    runRepository
      .listRunEvents(firstRun.id)
      .filter(({ type }) => type === "automation_step_completed").length,
    1,
  );

  runRepository.updateRun(reviewRun.id, "waiting_approval");
  await advanceEmailWorkflowExecutions(dependencies);
  assert.equal(
    automationExecutionRepository.getExecution(execution.id)?.status,
    "waiting_approval",
  );
  assert.equal(
    automationExecutionRepository.listSteps(execution.id)[1].status,
    "waiting_approval",
  );
  runRepository.updateRun(reviewRun.id, "completed");
  conversationRepository.addRunMessageOnce(
    reviewRun.threadId,
    reviewRun.id,
    "assistant",
    "Reply sent after approval.",
  );
  await advanceEmailWorkflowExecutions(dependencies);
  assert.equal(
    automationExecutionRepository.getExecution(execution.id)?.status,
    "completed",
  );

  const second = await startEmailAutomationRun(automation.id, 2, dependencies);
  assert.equal(second.status, "dispatched");
  assert.notEqual(second.run.id, firstRun.id);
  assert.equal(startedRuns.length, 3);
  runRepository.updateRun(second.run.id, "failed", {
    error: "Draft generation failed.",
  });
  await advanceEmailWorkflowExecutions(dependencies);
  const secondOccurrence = automationRepository.getEmailOccurrence(
    automation.id,
    2,
  );
  const secondExecution = automationExecutionRepository.getExecution(
    secondOccurrence.executionId,
  );
  assert.equal(secondExecution.status, "failed");
  assert.equal(automationExecutionRepository.listSteps(secondExecution.id)[1].runId, null);
  assert.equal(startedRuns.length, 3);
});
