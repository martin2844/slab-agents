import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";
register("./test-alias-loader.mjs", import.meta.url);

const directory = await mkdtemp(path.join(tmpdir(), "slab-whatsapp-hub-"));
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
  { approvalRepository },
  { whatsappAutomationRepository: turns },
  whatsapp,
  { whatsappAutomationSchema },
  guardrails,
  { sendOverdueWhatsAppReviews },
  hub,
  { whatsappApprovalServer },
  { db },
] = await Promise.all([
  import("../lib/repositories/agent-repository.ts"),
  import("../lib/repositories/run-repository.ts"),
  import("../lib/repositories/conversation-repository.ts"),
  import("../lib/repositories/automation-repository.ts"),
  import("../lib/repositories/approval-repository.ts"),
  import("../lib/repositories/whatsapp-automation-repository.ts"),
  import("../lib/integrations/whatsapp.ts"),
  import("../lib/whatsapp-automation.ts"),
  import("../lib/whatsapp-guardrails.ts"),
  import("../lib/whatsapp-review-fallback.ts"),
  import("../lib/whatsapp-hub.ts"),
  import("../lib/whatsapp-reply-policy.ts"),
  import("../lib/db/database.ts"),
]);

const account = "34600000000@c.us",
  chatId = "34611111111@c.us",
  otherChat = "34622222222@c.us";

const calls = [];
let sessionStatus = "WORKING";
let sentCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const route = new URL(url).pathname;
  calls.push({
    route,
    method: init.method ?? "GET",
    body: init.body ? JSON.parse(init.body) : null,
  });
  if (route === "/api/sessions/default")
    return Response.json({
      status: sessionStatus,
      me: { id: account },
      config: { noweb: { store: { enabled: true } }, webhooks: [] },
    });
  if (route === "/api/sendText")
    return Response.json({ id: { _serialized: `true_manual_${++sentCount}` } });
  if (route === "/api/contacts/all")
    return Response.json([{ id: otherChat, name: "", pushname: "Diego" }]);
  if (route === "/api/default/chats")
    return Response.json([{ id: chatId, name: "Lucía (Acme)" }]);
  if (route.endsWith("/messages"))
    return Response.json([
      { id: "m2", fromMe: true, body: "Hola, ¿en qué te ayudo?", timestamp: 1_800_000_010 },
      { id: "m1", fromMe: false, body: "Hola", timestamp: 1_800_000_000 },
    ]);
  return Response.json([]);
};

test.after(async () => {
  globalThis.fetch = originalFetch;
  db.close();
  await rm(directory, { recursive: true, force: true });
});

const agent = agentRepository.createAgent({
  name: "Vera",
  slug: "vera",
  role: "Support",
  instructions: "Help customers.",
  runtime: "codex",
  model: "default",
  enabled: true,
  fullAccess: false,
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
const config = whatsappAutomationSchema.parse({
  account,
  audience: "all",
  chatIds: [],
  replyApproval: "review_exceptions",
  reviewCriteria:
    "High-prospect B2B: companies asking about API volume or custom pricing.",
  reviewFallbackHours: 24,
});
const automation = automationRepository.createAutomation({
  name: "WhatsApp replies",
  agentId: agent.id,
  triggerType: "whatsapp",
  cronExpression: null,
  emailAccountId: null,
  prompt: "Answer as Vera.",
  mode: "task",
  enabled: true,
  lifecycleStatus: "enabled",
  whatsapp: config,
});

let clock = Date.now() + 5000;
let sequence = 0;
const ingest = (chat = chatId, extra = {}) => {
  clock += 1000;
  return turns.ingest(
    {
      account,
      chatId: chat,
      id: `message-${++sequence}`,
      text: "Necesito integrar la API para 50k consultas por mes",
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
const waitForApproval = (run, text = "Hola Lucía, te escribe Martín pronto.") => {
  runRepository.updateRun(run.id, "waiting_approval");
  return approvalRepository.create(run.id, `runner-${run.id}`, "whatsapp_send_text", {
    server: `whatsapp_review_${integration.slug}`,
    tool: "whatsapp_send_text",
    whatsappAction: { account, recipient: chatId, text },
  });
};

test("review_exceptions replies automatically by default and reviews only the exception", () => {
  assert.throws(
    () =>
      whatsappAutomationSchema.parse({
        account,
        audience: "all",
        chatIds: [],
        replyApproval: "review_exceptions",
        reviewCriteria: "",
      }),
    /review/,
  );
  assert.throws(() =>
    whatsappAutomationSchema.parse({ ...config, reviewFallbackHours: 500 }),
  );
  const instructions = guardrails.whatsappTurnInstructions(config, "Answer.", chatId);
  assert.match(instructions, /Reply automatically by default/);
  assert.match(instructions, /Do not stay silent/);
  assert.match(instructions, /High-prospect B2B/);
  assert.match(instructions, /within 24 hours, that exact draft is sent as-is/);
  assert.doesNotMatch(instructions, /ONLY when these criteria clearly hold/);
  const noFallback = guardrails.whatsappTurnInstructions(
    { ...config, reviewFallbackHours: 0 },
    "Answer.",
    chatId,
  );
  assert.doesNotMatch(noFallback, /sent as-is/);
});

test("overdue review drafts are sent after the fallback window, never early or for stale turns", async () => {
  assert.ok(ingest());
  const [run] = claim();
  assert.ok(run);
  assert.equal(
    whatsappApprovalServer(run.id, integration.slug, true),
    `whatsapp_review_${integration.slug}`,
    "the new mode exposes the review server",
  );
  const approval = waitForApproval(run);
  const created = Date.parse(approval.createdAt);
  const approved = [];
  const approve = async (id) => void approved.push(id);

  assert.deepEqual(
    await sendOverdueWhatsAppReviews(new Date(created + 23 * 3_600_000), { approve }),
    [],
  );
  assert.deepEqual(
    await sendOverdueWhatsAppReviews(new Date(created + 24 * 3_600_000 + 1), { approve }),
    [approval.id],
  );
  assert.deepEqual(approved, [approval.id]);
  assert.ok(runRepository.hasRunEvent(run.id, "whatsapp.review_fallback_sent"));

  // A newer customer message supersedes the turn: its draft must never be sent.
  approved.length = 0;
  assert.ok(ingest());
  assert.deepEqual(
    await sendOverdueWhatsAppReviews(new Date(created + 48 * 3_600_000), { approve }),
    [],
  );
  assert.deepEqual(approved, []);
  runRepository.updateRun(run.id, "cancelled");
  approvalRepository.closeOpen(run.id);
  turns.reconcile();
});

test("a manual reply from the hub supersedes the agent, pauses auto replies and joins the agent's history", async () => {
  const [run] = claim();
  assert.ok(run, "the pending message started a new turn");
  const threadId = run.threadId;
  await hub.sendManualWhatsAppReply({
    chatId,
    text: "Hola Lucía, soy Martín. Te llamo hoy.",
    keepAutoReplies: false,
  });
  const send = calls.findLast((call) => call.route === "/api/sendText");
  assert.equal(send.body.chatId, chatId);
  assert.equal(send.body.text, "Hola Lucía, soy Martín. Te llamo hoy.");
  const state = db
    .prepare("SELECT paused,pause_reason FROM whatsapp_conversations WHERE chat_id=?")
    .get(chatId);
  assert.equal(state.paused, 1);
  assert.match(state.pause_reason, /You replied from Slab/);
  assert.throws(() => turns.assertRun(run.id), /changed/, "the in-flight turn is superseded");
  const stored = db
    .prepare("SELECT from_me,handled FROM whatsapp_messages WHERE message_id=?")
    .get("true_manual_1");
  assert.deepEqual({ ...stored }, { from_me: 1, handled: 1 });
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM whatsapp_messages WHERE chat_id=? AND from_me=0 AND handled=0")
      .get(chatId).n,
    0,
    "customer messages count as answered",
  );
  assert.ok(
    conversationRepository
      .listMessages(threadId)
      .some((message) => message.body.includes("sent manually by the account owner")),
  );
  runRepository.updateRun(run.id, "cancelled");
  turns.reconcile();
  assert.equal(claim().length, 0, "the agent does not answer what the owner answered");

  // Keeping auto replies on still supersedes, without pausing.
  turns.setPaused(automation.id, chatId, false);
  await hub.sendManualWhatsAppReply({ chatId, text: "Gracias!", keepAutoReplies: true });
  assert.equal(
    db.prepare("SELECT paused FROM whatsapp_conversations WHERE chat_id=?").get(chatId).paused,
    0,
  );

  await assert.rejects(
    hub.sendManualWhatsAppReply({ chatId: otherChat, text: "Hi", keepAutoReplies: false }),
    /not found/,
    "only known automated chats can be replied to",
  );
  sessionStatus = "STOPPED";
  await assert.rejects(
    hub.sendManualWhatsAppReply({ chatId, text: "Hi", keepAutoReplies: false }),
    /disconnected/,
  );
  sessionStatus = "WORKING";
});

test("the hub lists chats with names, status and attention, and the nav badge matches", async () => {
  assert.ok(ingest(otherChat));
  const [run] = claim();
  assert.equal(run.threadId !== null, true);
  waitForApproval(run, "Hola, te contacta Martín.");

  const data = await hub.getWhatsAppHubData();
  assert.equal(data.enabled, true);
  assert.equal(data.connected, true);
  const first = data.conversations[0];
  assert.equal(first.chatId, otherChat, "approvals sort first");
  assert.equal(first.attention, "approval");
  assert.equal(first.approval.text, "Hola, te contacta Martín.");
  assert.ok(first.approval.fallbackAt, "shows when the draft auto-sends");
  const known = data.conversations.find((chat) => chat.chatId === chatId);
  assert.equal(known.contactName, "Lucía (Acme)");
  assert.equal(known.phone, "+34611111111");
  assert.equal(first.contactName, "Diego", "falls back to the push name");
  assert.equal(known.lastMessage.fromMe, true);
  assert.equal(known.lastMessage.body, "Gracias!");
  assert.equal(hub.getWhatsAppNavState().attention, data.attentionCount);

  // Taking a chat over is deliberate: it shows as paused but needs no action.
  turns.setPaused(automation.id, chatId, true);
  const afterTakeover = await hub.getWhatsAppHubData();
  const paused = afterTakeover.conversations.find((chat) => chat.chatId === chatId);
  assert.equal(paused.paused, true);
  assert.equal(paused.attention, null);
  assert.equal(afterTakeover.attentionCount, data.attentionCount);

  // A customer message after the takeover is waiting on the owner again.
  assert.ok(ingest(chatId, { text: "¿Hola? ¿Siguen ahí?" }));
  const waiting = (await hub.getWhatsAppHubData()).conversations.find(
    (chat) => chat.chatId === chatId,
  );
  assert.equal(waiting.attention, "pending");
  // Answering from the phone marks it answered and clears the attention.
  assert.ok(ingest(chatId, { fromMe: true, text: "Sí, decime." }));
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM whatsapp_messages WHERE chat_id=? AND from_me=0 AND handled=0")
      .get(chatId).n,
    0,
  );
  const answered = (await hub.getWhatsAppHubData()).conversations.find(
    (chat) => chat.chatId === chatId,
  );
  assert.equal(answered.attention, null);

  const history = await hub.getWhatsAppHubMessages(chatId);
  assert.equal(history.source, "whatsapp");
  assert.deepEqual(
    history.messages.map((message) => [message.id, message.timestamp]),
    [
      ["m1", 1_800_000_000_000],
      ["m2", 1_800_000_010_000],
    ],
  );

  db.prepare("UPDATE integrations SET enabled=0 WHERE provider='whatsapp'").run();
  assert.deepEqual(hub.getWhatsAppNavState(), { enabled: false, attention: 0 });
  assert.equal((await hub.getWhatsAppHubData()).enabled, false);
});
