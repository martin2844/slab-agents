import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";
register("./test-alias-loader.mjs", import.meta.url);

const directory = await mkdtemp(path.join(tmpdir(), "slab-run-retry-"));
const filename = path.join(directory, "workspace.db");
const migrations = knexFactory({
  client: "better-sqlite3",
  connection: { filename },
  useNullAsDefault: true,
  migrations: {
    directory: path.resolve("db/migrations"),
    loadExtensions: [".cjs"],
  },
});
await migrations.migrate.latest();
await migrations.destroy();
process.env.SLAB_WORKSPACE_DB = filename;
process.env.SLAB_WAHA_API_KEY_FILE = path.join(directory, "waha-key");
await writeFile(process.env.SLAB_WAHA_API_KEY_FILE, "private-waha-key");

const [
  { agentRepository },
  { runRepository },
  { conversationRepository },
  { automationRepository },
  { whatsappAutomationRepository: turns },
  whatsapp,
  { whatsappAutomationSchema },
  guardrails,
  { createRunExecution },
  { getRunRetryState, retryRun },
  { db },
  { GET: chatStatusRoute },
] = await Promise.all([
  import("../lib/repositories/agent-repository.ts"),
  import("../lib/repositories/run-repository.ts"),
  import("../lib/repositories/conversation-repository.ts"),
  import("../lib/repositories/automation-repository.ts"),
  import("../lib/repositories/whatsapp-automation-repository.ts"),
  import("../lib/integrations/whatsapp.ts"),
  import("../lib/whatsapp-automation.ts"),
  import("../lib/whatsapp-guardrails.ts"),
  import("../lib/run-service.ts"),
  import("../lib/run-retry.ts"),
  import("../lib/db/database.ts"),
  import("../app/api/threads/[id]/whatsapp/route.ts"),
]);

test.after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});

const agent = agentRepository.createAgent({
  name: "Retry assistant",
  slug: "retry-assistant",
  role: "Assistant",
  instructions: "Help the operator.",
  runtime: "codex",
  model: "default",
  enabled: true,
  fullAccess: false,
});
const state = (run) =>
  getRunRetryState(
    runRepository.getRun(run.id),
    runRepository.listRunEvents(run.id),
  );

test("failed runs retry once as a new run with the same input and policy", async () => {
  const thread = conversationRepository.createThread(agent.id, "Chat");
  const failed = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "Summarize the open incidents",
  });
  assert.equal(state(failed), null, "only failed runs are retryable");
  runRepository.updateRun(failed.id, "failed", {
    error: "An allowed MCP server could not be reached",
  });
  assert.deepEqual(state(failed), { status: "available" });

  const executed = [];
  const result = await retryRun(failed.id, {
    execute: async (id) => void executed.push(id),
  });
  assert.equal(result.strategy, "new_run");
  assert.deepEqual(executed, [result.runId]);
  const retry = runRepository.getRun(result.runId);
  assert.equal(retry.threadId, thread.id);
  assert.equal(retry.agentId, agent.id);
  assert.equal(retry.trigger, "chat");
  assert.equal(retry.mode, "chat");
  assert.equal(retry.runInstructions, failed.runInstructions);
  assert.equal(
    conversationRepository.getRunInput(retry.id).body,
    "Summarize the open incidents",
  );
  assert.equal(
    runRepository
      .listRunEvents(retry.id)
      .find((event) => event.type === "run_retry_of").payload.sourceRunId,
    failed.id,
  );
  assert.deepEqual(state(failed), {
    status: "retried",
    retryRunId: retry.id,
  });
  await assert.rejects(retryRun(failed.id), /already retried/);
});

test("Work runs keep their issue and exact trigger-specific instructions", async () => {
  const thread = conversationRepository.createThread(agent.id, "OPS-7");
  const failed = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "assignment",
    mode: "assignment",
    issueKey: "OPS-7",
    prompt: "OPS-7 was assigned",
    eventInstructions: "Coordinator note: focus on the rollout checklist.",
  });
  runRepository.updateRun(failed.id, "failed", { error: "Runner failed." });
  const { runId } = await retryRun(failed.id, { execute: async () => {} });
  const retry = runRepository.getRun(runId);
  assert.equal(retry.trigger, "assignment");
  assert.equal(retry.issueKey, "OPS-7");
  assert.match(retry.runInstructions, /rollout checklist/);
  assert.equal(retry.runInstructions, failed.runInstructions);
});

test("email steps and disabled agents explain why retry is unavailable", async () => {
  const thread = conversationRepository.createThread(agent.id, "Email");
  const email = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "email",
    mode: "task",
    prompt: "Reply to the customer",
  });
  runRepository.updateRun(email.id, "failed", { error: "Runner failed." });
  assert.equal(state(email).status, "unavailable");
  assert.match(state(email).reason, /workflow/);
  await assert.rejects(retryRun(email.id), /workflow/);

  const other = agentRepository.createAgent({
    name: "Paused assistant",
    slug: "paused-assistant",
    role: "Assistant",
    instructions: "Help.",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const otherThread = conversationRepository.createThread(other.id, "Chat");
  const run = createRunExecution({
    agentId: other.id,
    threadId: otherThread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "Hi",
  });
  runRepository.updateRun(run.id, "failed", { error: "Runner failed." });
  agentRepository.updateAgent(other.id, { enabled: false });
  assert.deepEqual(state(run), {
    status: "unavailable",
    reason: "This agent is disabled.",
  });
});

test("WhatsApp retries requeue an unanswered turn and never risk a duplicate reply", async (t) => {
  const account = "34600000000@c.us",
    chatId = "34611111111@c.us";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let integration = whatsapp.syncWhatsAppAccount({
    status: "WORKING",
    me: { id: account },
    config: { noweb: { store: { enabled: true } }, webhooks: [] },
  });
  integration = whatsapp.setWhatsAppAccess({
    agentId: agent.id,
    read: true,
    write: "approval_required",
    expectedVersion: integration.version,
  });
  const automation = automationRepository.createAutomation({
    name: "WhatsApp replies",
    agentId: agent.id,
    triggerType: "whatsapp",
    cronExpression: null,
    emailAccountId: null,
    prompt: "Answer factual questions.",
    mode: "task",
    enabled: true,
    lifecycleStatus: "enabled",
    whatsapp: whatsappAutomationSchema.parse({ account, chatIds: [chatId] }),
  });
  let clock = Date.now() + 5000;
  let sequence = 0;
  const ingest = (extra = {}) => {
    clock += 1000;
    return turns.ingest(
      {
        account,
        chatId,
        id: `message-${++sequence}`,
        text: "Do you ship to Madrid?",
        timestampMs: Math.floor(clock / 1000) * 1000,
        fromMe: false,
        source: "app",
        ...extra,
      },
      new Date(clock),
    );
  };
  const create = (current, threadId, messages, currentChat) => {
    const run = runRepository.createRun({
      agentId: agent.id,
      threadId,
      automationId: current.id,
      trigger: "whatsapp",
      mode: "chat",
      runInstructions: guardrails.whatsappTurnInstructions(
        current.whatsapp,
        current.prompt,
        currentChat,
      ),
    });
    conversationRepository.addMessage(
      threadId,
      run.id,
      "user",
      JSON.stringify(messages.map((message) => message.message_id)),
    );
    return run;
  };
  const claim = () => turns.claimDue(create, new Date(clock + 3_600_000));
  const failTurn = () => {
    const [run] = claim();
    assert.ok(run, "a turn was claimed");
    runRepository.updateRun(run.id, "failed", {
      error: "An allowed MCP server could not be reached",
    });
    turns.reconcile();
    return run;
  };
  const chat = () =>
    db
      .prepare(
        "SELECT paused,pause_reason,active_run_id FROM whatsapp_conversations WHERE account=? AND chat_id=?",
      )
      .get(account, chatId);
  const messagesOf = (runId) =>
    db
      .prepare(
        "SELECT message_id FROM whatsapp_messages WHERE run_id=? ORDER BY sequence",
      )
      .all(runId)
      .map((row) => row.message_id);

  assert.ok(ingest());
  const failed = failTurn();
  assert.equal(chat().paused, 1, "a failed turn pauses the chat");
  assert.match(chat().pause_reason, /run failed/);
  assert.deepEqual(state(failed), { status: "available" });

  // A message that arrived after the failure is answered with the retried turn.
  assert.ok(ingest({ text: "Also, do you have it in blue?" }));
  const result = await retryRun(failed.id, {
    tickWhatsApp: async () => claim(),
  });
  assert.equal(result.strategy, "whatsapp_requeue");
  assert.ok(result.runId);
  assert.notEqual(result.runId, failed.id);
  assert.deepEqual(messagesOf(result.runId), ["message-1", "message-2"]);
  assert.equal(chat().paused, 0);
  assert.equal(chat().active_run_id, result.runId);
  assert.deepEqual(state(failed), {
    status: "retried",
    retryRunId: result.runId,
  });
  assert.ok(
    runRepository
      .listRunEvents(result.runId)
      .some(
        (event) =>
          event.type === "run_retry_of" &&
          event.payload.sourceRunId === failed.id,
      ),
  );
  await assert.rejects(retryRun(failed.id), /already retried/);
  runRepository.updateRun(result.runId, "completed");
  turns.reconcile();

  // A turn that already attempted a reply cannot be retried.
  assert.ok(ingest());
  const attempted = failTurn();
  db.prepare(
    "INSERT INTO whatsapp_reply_receipts (run_id,status,created_at) VALUES (?,'uncertain',?)",
  ).run(attempted.id, new Date().toISOString());
  assert.equal(state(attempted).status, "unavailable");
  assert.match(state(attempted).reason, /already tried to send a reply/);
  await assert.rejects(
    retryRun(attempted.id, { tickWhatsApp: async () => claim() }),
    /already tried to send a reply/,
  );
  turns.setPaused(automation.id, chatId, false);

  // The owner answering from the phone after the failure blocks the retry.
  assert.ok(ingest());
  const ownerAnswered = failTurn();
  assert.ok(ingest({ fromMe: true, text: "Yes, we do." }));
  assert.match(state(ownerAnswered).reason, /replied from WhatsApp/);
  turns.setPaused(automation.id, chatId, false);

  // A newer turn already ran in the chat: retrying the old one is out of order.
  assert.ok(ingest());
  const older = failTurn();
  turns.setPaused(automation.id, chatId, false);
  assert.ok(ingest());
  const [newer] = claim();
  assert.ok(newer);
  assert.match(state(older).reason, /Another turn is in progress/);
  runRepository.updateRun(newer.id, "completed");
  turns.reconcile();
  assert.match(state(older).reason, /newer turn already ran/);
  await assert.rejects(retryRun(older.id), /newer turn already ran/);

  // No duplicate requeue happened for blocked retries.
  assert.deepEqual(messagesOf(attempted.id).length, 1);
});

test("the chat window sees the retry state of its last failed turn", async (t) => {
  const account = "34600000000@c.us",
    chatId = "34633333333@c.us";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const automation = automationRepository.createAutomation({
    name: "WhatsApp chat retry",
    agentId: agent.id,
    triggerType: "whatsapp",
    cronExpression: null,
    emailAccountId: null,
    prompt: "Answer customers.",
    mode: "task",
    enabled: true,
    lifecycleStatus: "enabled",
    whatsapp: whatsappAutomationSchema.parse({ account, chatIds: [chatId] }),
  });
  let clock = Date.now() + 5000;
  const ingest = () => {
    clock += 1000;
    return turns.ingest(
      {
        account,
        chatId,
        id: `chat-retry-${clock}`,
        text: "Do you ship to Berlin?",
        timestampMs: Math.floor(clock / 1000) * 1000,
        fromMe: false,
        source: "app",
      },
      new Date(clock),
    );
  };
  const create = (current, threadId, messages, currentChat) => {
    const run = runRepository.createRun({
      agentId: agent.id,
      threadId,
      automationId: current.id,
      trigger: "whatsapp",
      mode: "chat",
      runInstructions: guardrails.whatsappTurnInstructions(
        current.whatsapp,
        current.prompt,
        currentChat,
      ),
    });
    conversationRepository.addMessage(
      threadId,
      run.id,
      "user",
      JSON.stringify(messages.map((message) => message.message_id)),
    );
    return run;
  };
  const chatStatus = async () => {
    const thread = db
      .prepare(
        "SELECT thread_id FROM whatsapp_threads WHERE account=? AND chat_id=?",
      )
      .get(account, chatId);
    const response = await chatStatusRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ id: thread.thread_id }),
    });
    return (await response.json()).data;
  };

  assert.ok(ingest());
  const [running] = turns.claimDue(create, new Date(clock + 3_600_000));
  assert.ok(running, "a turn was claimed");
  assert.equal(
    (await chatStatus()).failedRun,
    null,
    "an active turn is not retryable from the chat",
  );
  runRepository.updateRun(running.id, "failed", {
    error: "An allowed MCP server could not be reached",
  });
  turns.reconcile();
  const failed = await chatStatus();
  assert.equal(failed.chat.paused, true);
  assert.match(failed.chat.pauseReason, /run failed/);
  assert.equal(failed.failedRun.runId, running.id);
  assert.deepEqual(failed.failedRun.retry, { status: "available" });

  const result = await retryRun(running.id, {
    tickWhatsApp: async () =>
      turns.claimDue(create, new Date(clock + 7_200_000)),
  });
  assert.ok(result.runId);
  const retried = await chatStatus();
  assert.equal(
    retried.failedRun,
    null,
    "the retry run is the last turn now, so nothing is left to retry",
  );
  assert.equal(retried.chat.activeRunId, result.runId);

  const plain = conversationRepository.createThread(agent.id, "Plain chat");
  const response = await chatStatusRoute(new Request("http://localhost/"), {
    params: Promise.resolve({ id: plain.id }),
  });
  assert.equal((await response.json()).data, null);
});
