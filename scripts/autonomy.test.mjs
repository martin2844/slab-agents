import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

const directory = await mkdtemp(path.join(tmpdir(), "slab-autonomy-"));
const filename = path.join(directory, "workspace.db");
const migrations = knexFactory({
  client: "better-sqlite3",
  connection: { filename },
  useNullAsDefault: true,
  migrations: { directory: path.resolve("db/migrations"), loadExtensions: [".cjs"] },
});
await migrations.migrate.latest();
await migrations.destroy();
process.env.SLAB_WORKSPACE_DB = filename;
process.env.RUNNER_URL = "http://runner.test";
process.env.WORK_MCP_URL = "http://work.test/mcp";
process.env.TELEGRAM_API_URL = "http://telegram.test";

// ---------------------------------------------------------------------------
// Fakes: the agent runner (every run answers "OK") and the Telegram Bot API.

const runnerBodies = [];
const telegramCalls = [];
let telegramUpdates = [];
let nextMessageId = 100;

function sse(events) {
  return new Response(events.map((event) => `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (resource, init = {}) => {
  const url = new URL(String(resource));
  const method = (init.method ?? "GET").toUpperCase();
  const json = init.body ? JSON.parse(String(init.body)) : null;
  if (url.host === "runner.test") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "runs" && parts.length === 1 && method === "POST") {
      runnerBodies.push(json);
      return Response.json({ runId: json.runId, status: "running" }, { status: 202 });
    }
    if (parts[0] === "runs" && parts[2] === "attach") return Response.json({ error: { code: "RUN_NOT_FOUND", message: "no" } }, { status: 404 });
    if (parts[0] === "runs" && parts[2] === "events") {
      const timestamp = new Date().toISOString();
      return sse([
        { id: 1, type: "run.started", runId: parts[1], timestamp, data: {} },
        { id: 2, type: "assistant.completed", runId: parts[1], timestamp, data: { message: "OK" } },
        { id: 3, type: "run.completed", runId: parts[1], timestamp, data: {} },
      ]);
    }
    if (parts[0] === "runs" && parts[2] === "approvals") return Response.json({ status: "resolved" });
    return Response.json({ error: { code: "UNEXPECTED", message: `${method} ${url.pathname}` } }, { status: 500 });
  }
  if (url.host === "telegram.test") {
    const methodName = url.pathname.split("/").pop();
    telegramCalls.push({ method: methodName, body: json });
    if (methodName === "getMe") return Response.json({ ok: true, result: { id: 777, is_bot: true, username: "cleancut_ops_bot" } });
    if (methodName === "getUpdates") {
      const updates = telegramUpdates;
      telegramUpdates = [];
      return Response.json({ ok: true, result: updates });
    }
    if (methodName === "sendMessage") {
      return Response.json({ ok: true, result: { message_id: nextMessageId++, date: 0, chat: { id: Number(json.chat_id), type: "private" }, text: json.text } });
    }
    return Response.json({ ok: true, result: true });
  }
  if (url.host === "work.test" || url.host.startsWith("127.0.0.1")) return new Response("unavailable", { status: 503 });
  return realFetch(resource, init);
};

const [
  policyModule,
  autonomy,
  { applyAutonomyToolPolicies },
  humanRequests,
  followups,
  proposals,
  control,
  loops,
  telegram,
  { db },
  { agentRepository },
  { conversationRepository },
  { runRepository },
  { approvalRepository },
  { automationRepository },
  { autonomyRepository },
] = await Promise.all([
  import("../lib/autonomy/policy.ts"),
  import("../lib/autonomy/service.ts"),
  import("../lib/autonomy/tool-policy.ts"),
  import("../lib/autonomy/human-requests.ts"),
  import("../lib/autonomy/followups.ts"),
  import("../lib/autonomy/proposals.ts"),
  import("../lib/autonomy/control-mcp.ts"),
  import("../lib/autonomy/loops.ts"),
  import("../lib/telegram/service.ts"),
  import("../lib/db/database.ts"),
  import("../lib/repositories/agent-repository.ts"),
  import("../lib/repositories/conversation-repository.ts"),
  import("../lib/repositories/run-repository.ts"),
  import("../lib/repositories/approval-repository.ts"),
  import("../lib/repositories/automation-repository.ts"),
  import("../lib/repositories/autonomy-repository.ts"),
]);

test.after(async () => {
  // Let background runs settle before the database closes.
  db.prepare("UPDATE runs SET status='cancelled' WHERE status IN ('queued','running','waiting_approval')").run();
  await new Promise((resolve) => setTimeout(resolve, 800));
  db.close();
  await rm(directory, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function agent(slug, extra = {}) {
  return (
    agentRepository.getAgent(slug) ??
    agentRepository.createAgent({
      name: slug.toUpperCase(),
      slug,
      role: `${slug} role`,
      instructions: `You are ${slug}.`,
      model: "default",
      enabled: true,
      fullAccess: false,
      runtime: "codex",
      permissionMode: "full",
      ...extra,
    })
  );
}

function setLevel(level, extra = {}) {
  db.prepare("DELETE FROM settings WHERE key='autonomy_policy'").run();
  if (level !== null) autonomy.updateAutonomyPolicy({ level, ...extra });
}

async function waitFor(predicate, label, attempts = 200) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ---------------------------------------------------------------------------
// Policy (pure)

test("without settings the policy is level 1, which adds nothing to Slab", () => {
  const policy = policyModule.resolveAutonomyPolicy(null);
  assert.equal(policy.level, 1);
  assert.equal(policy.paused, false);
  assert.deepEqual(policy.capabilities, policyModule.LEVEL_PRESETS[1]);
  for (const capability of ["planning", "followups", "ask_human", "delegate", "memory_all_runs", "guards"]) {
    assert.equal(policy.capabilities[capability], "off", capability);
  }
  assert.equal(policy.capabilities.triggers, "on");
  assert.equal(policy.capabilities.self_manage, "off");
  assert.equal(policy.capabilities.outbound, "policy");
  assert.equal(policy.capabilities.tool_approvals, "policy");
  // Garbage in the stored policy falls back to level 1 as well.
  assert.equal(policyModule.resolveAutonomyPolicy({ level: 9, overrides: { triggers: "maybe" } }).level, 1);
});

test("overrides, pause, and agent caps resolve as documented", () => {
  const stored = { level: 3, overrides: { coding_gates: "human" }, agentCaps: { support: 1 } };
  const policy = policyModule.resolveAutonomyPolicy(stored);
  assert.equal(policy.capabilities.coding_gates, "human");
  assert.equal(policy.capabilities.self_manage, "auto");
  const capped = policyModule.capabilitiesForAgent(policy, "support");
  assert.equal(capped.self_manage, "off");
  assert.equal(capped.outbound, "policy");
  assert.equal(capped.triggers, "on");
  assert.equal(policyModule.capabilitiesForAgent(policy, "other").self_manage, "auto");
  const paused = policyModule.resolveAutonomyPolicy({ ...stored, pausedFromLevel: 3 });
  assert.equal(paused.level, 0);
  assert.equal(paused.configuredLevel, 3);
  assert.deepEqual(paused.capabilities, policyModule.LEVEL_PRESETS[0], "a pause ignores overrides");
  assert.equal(policyModule.normalizeLimits({ maxConcurrentRuns: 999, timezone: "Nowhere/City" }).maxConcurrentRuns, 50);
  assert.equal(policyModule.normalizeLimits({ timezone: "Nowhere/City" }).timezone, policyModule.DEFAULT_LIMITS.timezone);
});

test("pause and resume keep the configured level and log the change", () => {
  setLevel(2);
  autonomy.pauseAutonomy("test");
  assert.equal(autonomy.getAutonomyPolicy().level, 0);
  assert.equal(autonomy.allows("triggers"), false);
  // Changing the level while paused changes the level restored on resume.
  autonomy.updateAutonomyPolicy({ level: 3 }, "test");
  assert.equal(autonomy.getAutonomyPolicy().level, 0);
  const resumed = autonomy.resumeAutonomy("test");
  assert.equal(resumed.level, 3);
  assert.ok(autonomy.listAutonomyEvents().some((event) => event.kind === "paused"));
  assert.ok(autonomy.listAutonomyEvents().some((event) => event.kind === "resumed"));
  setLevel(null);
});

// ---------------------------------------------------------------------------
// Tool policies

const catalog = [
  { serverName: "work", tools: [{ name: "update_issue", sensitiveAction: null }, { name: "delete_issue", sensitiveAction: "destructive" }] },
  { serverName: "email", tools: [{ name: "email_send", sensitiveAction: "external_communication" }, { name: "email_reply", sensitiveAction: "external_communication" }] },
];
const basePolicies = () => ({
  work: { defaultMode: "prompt", tools: { list_projects: "approve" } },
  email: { defaultMode: "prompt", tools: { email_send: "prompt", email_reply: "prompt" } },
  whatsapp_main: { defaultMode: "prompt", tools: { whatsapp_send_text: "prompt" } },
  slab: { defaultMode: "prompt", tools: {} },
});

test("tool policies do not change at level 1 and follow outbound and approvals above it", () => {
  const owner = agent("ops");
  setLevel(null);
  const unchanged = applyAutonomyToolPolicies(basePolicies(), { agentId: owner.id, trigger: "automation", catalog });
  assert.deepEqual(unchanged.work, basePolicies().work);
  assert.deepEqual(unchanged.email, basePolicies().email);
  assert.deepEqual(unchanged.slab, { defaultMode: "approve", tools: {} }, "the control server is governed by autonomy");

  setLevel(3);
  const auto = applyAutonomyToolPolicies(basePolicies(), { agentId: owner.id, trigger: "automation", catalog });
  assert.equal(auto.work.tools.update_issue, "approve");
  assert.equal(auto.work.tools.delete_issue, "prompt", "red line");
  assert.equal(auto.email.tools.email_send, "approve", "outbound auto");
  assert.equal(auto.email.tools.email_reply, "approve");
  assert.equal(auto.whatsapp_main.tools.whatsapp_send_text, "approve");
  const inWhatsApp = applyAutonomyToolPolicies(basePolicies(), { agentId: owner.id, trigger: "whatsapp", catalog });
  assert.equal(inWhatsApp.whatsapp_main.tools.whatsapp_send_text, "prompt", "WhatsApp replies keep their own policy");

  setLevel(2);
  const supervised = applyAutonomyToolPolicies(basePolicies(), { agentId: owner.id, trigger: "automation", catalog });
  assert.equal(supervised.email.tools.email_send, "prompt");
  assert.equal(supervised.work.tools.update_issue, undefined, "approvals follow the agent policy at level 2");

  // An explicit cap (email send policy "approval required") wins over automatic outbound.
  const cappedCatalog = [catalog[0], { serverName: "email", tools: [{ name: "email_send", sensitiveAction: "external_communication", maximumMode: "prompt" }] }];
  setLevel(3);
  assert.equal(
    applyAutonomyToolPolicies(basePolicies(), { agentId: owner.id, trigger: "automation", catalog: cappedCatalog }).email.tools.email_send,
    "prompt",
  );

  setLevel(3, { overrides: { outbound: "off" } });
  const silent = applyAutonomyToolPolicies(basePolicies(), { agentId: owner.id, trigger: "automation", catalog });
  assert.equal(silent.email.tools.email_send, "deny");
  setLevel(null);
});

// ---------------------------------------------------------------------------
// Runs that autonomy starts

function runningRun(agentId, prompt = "Do the thing.") {
  const thread = conversationRepository.createThread(agentId, "Test");
  const run = runRepository.createRun({
    agentId,
    threadId: thread.id,
    runtime: "codex",
    model: "default",
    reasoningEffort: "default",
    trigger: "manual",
    mode: "task",
    issueKey: null,
    runInstructions: "",
  });
  conversationRepository.addMessage(thread.id, run.id, "user", prompt);
  runRepository.updateRun(run.id, "running");
  return run;
}

test("a question to the human continues the agent with the answer, or with the default after the wait", async () => {
  setLevel(2);
  const owner = agent("support");
  const run = runningRun(owner.id, "Answer the refund email.");
  const question = humanRequests.createHumanRequest({
    kind: "question",
    runId: run.id,
    agentId: owner.id,
    question: "Refund the customer?",
    options: ["Yes", "No"],
  });
  assert.equal(question.status, "pending");
  const answered = humanRequests.answerHumanRequest(question.id, "Yes", "operator");
  assert.ok(answered.continuationRunId);
  const continuation = runRepository.getRun(answered.continuationRunId);
  assert.equal(continuation.trigger, "autonomy");
  assert.equal(continuation.agentId, owner.id);
  const prompt = conversationRepository.getRunInput(continuation.id).body;
  assert.match(prompt, /Question: Refund the customer\?/);
  assert.match(prompt, /Answer: Yes/);
  assert.match(prompt, /Answer the refund email\./);
  assert.equal(autonomyRepository.runDepth(continuation.id), 1);
  assert.throws(() => humanRequests.answerHumanRequest(question.id, "No", "operator"), /already answered/);

  const timed = humanRequests.createHumanRequest({
    kind: "question",
    runId: run.id,
    agentId: owner.id,
    question: "Which plan?",
    defaultAnswer: "The cheapest one.",
  });
  db.prepare("UPDATE human_requests SET expires_at=? WHERE id=?").run(new Date(Date.now() - 1_000).toISOString(), timed.id);
  assert.equal(humanRequests.expireHumanRequests(), 1);
  const expired = humanRequests.getHumanRequest(timed.id);
  assert.equal(expired.status, "expired");
  assert.equal(expired.answer, "The cheapest one.");
  assert.match(conversationRepository.getRunInput(expired.continuationRunId).body, /Answer: The cheapest one\./);
  setLevel(null);
});

test("follow-ups exist only above level 1 and start the agent when due", async () => {
  const owner = agent("growth");
  setLevel(null);
  assert.throws(
    () => followups.scheduleFollowup({ agentId: owner.id, runId: null, dueAt: new Date(Date.now() + 3_600_000), note: "Check signups" }),
    /off at this autonomy level/,
  );
  setLevel(2);
  assert.throws(
    () => followups.scheduleFollowup({ agentId: owner.id, runId: null, dueAt: new Date(Date.now() + 1_000), note: "Too soon" }),
    /at least one minute/,
  );
  const scheduled = followups.scheduleFollowup({ agentId: owner.id, runId: null, dueAt: new Date(Date.now() + 3_600_000), note: "Check signups" });
  assert.equal(scheduled.status, "pending");
  db.prepare("UPDATE agent_wakeups SET due_at=? WHERE id=?").run(new Date(Date.now() - 1_000).toISOString(), scheduled.id);
  // Paused: due follow-ups wait for the resume.
  autonomy.pauseAutonomy("test");
  await loops.tickAutonomy();
  assert.equal(autonomyRepository.getFollowup(scheduled.id).status, "pending");
  autonomy.resumeAutonomy("test");
  assert.equal(followups.fireDueFollowups(), 1);
  const fired = autonomyRepository.getFollowup(scheduled.id);
  assert.equal(fired.status, "fired");
  assert.match(conversationRepository.getRunInput(fired.firedRunId).body, /Check signups/);
  setLevel(null);
});

test("guards stop deep delegation chains and too many autonomous runs per day", () => {
  setLevel(2, { limits: { maxDelegationDepth: 1, maxAutonomousRunsPerDay: 1000 } });
  const lead = agent("lead");
  const helper = agent("helper");
  const root = runningRun(lead.id);
  const autonomyRuns = import("../lib/autonomy/runs.ts");
  return autonomyRuns.then(({ startAutonomyRun }) => {
    const first = startAutonomyRun({ agentId: helper.id, prompt: "A", origin: "delegate", parentRunId: root.id, title: "A", actor: "test" });
    assert.equal(autonomyRepository.runDepth(first.id), 1);
    assert.throws(
      () => startAutonomyRun({ agentId: lead.id, prompt: "B", origin: "delegate", parentRunId: first.id, title: "B", actor: "test" }),
      /depth limit/,
    );
    autonomy.updateAutonomyPolicy({ limits: { maxDelegationDepth: 5, maxAutonomousRunsPerDay: 1 } });
    assert.throws(
      () => startAutonomyRun({ agentId: lead.id, prompt: "C", origin: "delegate", parentRunId: root.id, title: "C", actor: "test" }),
      /daily limit/,
    );
    autonomy.pauseAutonomy("test");
    assert.throws(
      () => startAutonomyRun({ agentId: lead.id, prompt: "D", origin: "planning", title: "D", actor: "test" }),
      /paused/,
    );
    autonomy.resumeAutonomy("test");
    setLevel(null);
  });
});

// ---------------------------------------------------------------------------
// Self-management

test("agents propose changes: drafts at level 2, applied at level 3, never at level 1", () => {
  const owner = agent("chief");
  const worker = agent("worker");
  const payload = { name: "Weekly churn review", agentId: worker.slug, cronExpression: "0 9 * * 1", scheduleTimezone: "America/Argentina/Buenos_Aires", prompt: "Review churn.", mode: "task" };
  setLevel(null);
  assert.throws(() => proposals.proposeChange({ kind: "create_automation", agentId: owner.id, runId: null, payload }), /off at this autonomy level/);

  setLevel(2);
  const draft = proposals.proposeChange({ kind: "create_automation", agentId: owner.id, runId: null, payload });
  assert.equal(draft.status, "pending");
  assert.equal(automationRepository.listAutomations().length, 0);
  const applied = proposals.decideProposal(draft.id, "approve", "operator");
  assert.equal(applied.status, "applied");
  const automation = automationRepository.getAutomation(applied.resultId);
  assert.equal(automation.agentId, worker.id);
  assert.equal(automation.cronExpression, "0 9 * * 1");
  assert.throws(() => proposals.decideProposal(draft.id, "approve", "operator"), /already decided/);
  assert.throws(
    () => proposals.proposeChange({ kind: "create_automation", agentId: owner.id, runId: null, payload: { ...payload, cronExpression: "nope" } }),
  );

  setLevel(3);
  const created = proposals.proposeChange({
    kind: "create_agent",
    agentId: owner.id,
    runId: null,
    payload: { name: "Outreach", role: "Finds and contacts leads", instructions: "Contact leads politely and record opt-outs." },
  });
  assert.equal(created.status, "applied");
  const newAgent = agentRepository.getAgent(created.resultId);
  assert.equal(newAgent.permissionMode, "full", "agents never create yolo agents");
  assert.equal(newAgent.slug, "outreach");
  const paused = proposals.proposeChange({ kind: "set_automation_enabled", agentId: owner.id, runId: null, payload: { automationId: automation.id, enabled: false } });
  assert.equal(paused.status, "applied");
  assert.equal(automationRepository.getAutomation(automation.id).enabled, false);
  setLevel(null);
});

// ---------------------------------------------------------------------------
// The Slab control MCP server

async function callMcp(runId, token, method, params = {}) {
  const response = await control.handleControlMcpRequest(
    new Request(`http://slab.test/api/autonomy/mcp?run=${runId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    runId,
  );
  return { status: response.status, body: response.status === 200 ? await response.json() : await response.text() };
}

test("the control server exists only when a capability is on, and its tools act on autonomy", async () => {
  const owner = agent("cto");
  setLevel(null);
  assert.equal(control.issueControlServer("run-x", owner.id), null);

  setLevel(2);
  const run = runningRun(owner.id);
  const issued = control.issueControlServer(run.id, owner.id);
  assert.ok(issued.tools.includes("ask_human"));
  assert.ok(issued.tools.includes("create_automation"));
  assert.match(issued.server.url, /\/api\/autonomy\/mcp\?run=/);
  const token = issued.server.credentials.bearerToken;

  assert.equal((await callMcp(run.id, "wrong-token", "tools/list")).status, 401);
  const listed = await callMcp(run.id, token, "tools/list");
  assert.equal(listed.status, 200);
  const names = listed.body.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("schedule_followup"));

  const asked = await callMcp(run.id, token, "tools/call", { name: "ask_human", arguments: { question: "Ship it on Friday?", options: ["Yes", "No"] } });
  assert.match(asked.body.result.content[0].text, /End this run now/);
  assert.ok(humanRequests.listHumanRequests({ status: "pending" }).some((request) => request.question === "Ship it on Friday?"));

  const scheduled = await callMcp(run.id, token, "tools/call", { name: "schedule_followup", arguments: { note: "Check the release", in_hours: 2 } });
  assert.match(scheduled.body.result.content[0].text, /dueAt/);

  // A pause turns the tools off in the middle of a run.
  autonomy.pauseAutonomy("test");
  const blocked = await callMcp(run.id, token, "tools/call", { name: "notify_human", arguments: { message: "Hello there" } });
  // The tool is gone (JSON-RPC error) or refuses the call.
  assert.ok(blocked.body.error || blocked.body.result?.isError, JSON.stringify(blocked.body));
  autonomy.resumeAutonomy("test");

  // Finished runs lose access.
  runRepository.updateRun(run.id, "completed");
  assert.equal((await callMcp(run.id, token, "tools/list")).status, 401);
  setLevel(null);
});

// ---------------------------------------------------------------------------
// Planning loop and approval timeouts

test("the planning loop runs the lead agent every N hours, only above level 1", () => {
  const lead = agent("ceo");
  setLevel(null, {});
  autonomy.updateAutonomyPolicy({ leadAgentId: lead.id });
  assert.equal(loops.tickPlanning(new Date()), null, "level 1 has no planning loop");
  autonomy.updateAutonomyPolicy({ level: 2, limits: { planningEveryHours: 6 } });
  const first = loops.tickPlanning(new Date());
  assert.ok(first);
  assert.equal(first.mode, "review");
  assert.equal(first.trigger, "autonomy");
  assert.equal(loops.tickPlanning(new Date(Date.now() + 3_600_000)), null, "not before 6 hours");
  setLevel(null);
});

test("an agent paces itself: a chain of follow-ups never hits the delegation depth limit", () => {
  setLevel(3, { limits: { maxDelegationDepth: 1, maxAutonomousRunsPerDay: 1000 } });
  const owner = agent("pacer");
  let source = runningRun(owner.id);
  for (let hop = 0; hop < 4; hop += 1) {
    const next = followups.scheduleFollowup({ agentId: owner.id, runId: source.id, dueAt: new Date(Date.now() + 3_600_000), note: `Round ${hop}` });
    db.prepare("UPDATE agent_wakeups SET due_at=? WHERE id=?").run(new Date(Date.now() - 1_000).toISOString(), next.id);
    followups.fireDueFollowups();
    const fired = autonomyRepository.getFollowup(next.id);
    assert.equal(fired.status, "fired", `hop ${hop} fired`);
    assert.equal(autonomyRepository.runDepth(fired.firedRunId), 0);
    source = runRepository.getRun(fired.firedRunId);
  }
  setLevel(null);
});

test("the lead schedules its own planning loops; the fixed loop is only a fallback", () => {
  const lead = agent("ceo-paced");
  setLevel(3, { limits: { planningEveryHours: 6, maxAutonomousRunsPerDay: 1000 } });
  autonomy.updateAutonomyPolicy({ leadAgentId: lead.id });
  const finishRuns = () => db.prepare("UPDATE runs SET status='completed' WHERE status NOT IN ('completed','failed','cancelled','skipped')").run();
  finishRuns();
  const start = Date.now() + 30 * 3_600_000;
  const first = loops.tickPlanning(new Date(start));
  assert.ok(first, "no loop yet: the fallback starts one");
  assert.match(conversationRepository.getRunInput(first.id).body, /Planning loop:/);
  // The lead chose to look again in 8 hours: no fallback loop at 7 hours.
  const planned = followups.scheduleFollowup({ agentId: lead.id, runId: first.id, dueAt: new Date(Date.now() + 8 * 3_600_000), note: "Planning loop: check the PR reviews" });
  finishRuns();
  assert.equal(loops.tickPlanning(new Date(start + 7 * 3_600_000)), null);
  db.prepare("UPDATE agent_wakeups SET due_at=? WHERE id=?").run(new Date(Date.now() - 1_000).toISOString(), planned.id);
  followups.fireDueFollowups();
  const fired = autonomyRepository.getFollowup(planned.id);
  const body = conversationRepository.getRunInput(fired.firedRunId).body;
  assert.match(body, /Run the planning loop/);
  assert.match(body, /check the PR reviews/);
  assert.equal(runRepository.getRun(fired.firedRunId).mode, "review");
  // A loop scheduled far away does not stop the fallback.
  finishRuns();
  followups.scheduleFollowup({ agentId: lead.id, runId: null, dueAt: new Date(Date.now() + 80 * 86_400_000), note: "Planning loop: much later" });
  assert.ok(loops.tickPlanning(new Date(Date.now() + 7 * 3_600_000)));
  setLevel(null);
});

test("approvals that wait too long get a Telegram reminder, then a denial when the policy says so", async () => {
  const owner = agent("finance");
  setLevel(3, { limits: { approvalRemindMinutes: 5, approvalDenyHours: 1 } });
  const run = runningRun(owner.id);
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(run.id, "runner-approval-1", "Send invoice to client", {});
  db.prepare("UPDATE approvals SET created_at=? WHERE id=?").run(new Date(Date.now() - 10 * 60_000).toISOString(), approval.id);
  await loops.tickApprovalTimeouts();
  assert.ok(autonomyRepository.listPendingApprovals().find((item) => item.id === approval.id).remindedAt);
  db.prepare("UPDATE approvals SET created_at=? WHERE id=?").run(new Date(Date.now() - 2 * 3_600_000).toISOString(), approval.id);
  await loops.tickApprovalTimeouts();
  assert.equal(approvalRepository.get(approval.id).status, "denied");
  assert.ok(autonomy.listAutonomyEvents().some((event) => event.kind === "approval_denied_timeout"));
  setLevel(null);
});

// ---------------------------------------------------------------------------
// Telegram

const message = (text, extra = {}) => ({
  update_id: nextMessageId++,
  message: { message_id: nextMessageId++, date: 0, chat: { id: 4242, type: "private", username: "martin" }, text, ...extra },
});

test("Telegram links one chat with a one-time code and ignores every other chat", async () => {
  await assert.rejects(() => telegram.configureTelegram("not a token"), /does not look like/);
  // A fake token built at runtime, so secret scanners do not mistake it for a real one.
  const fakeToken = ["1234", "56789"].join("") + ":" + "x".repeat(35);
  const linking = await telegram.configureTelegram(fakeToken);
  assert.equal(linking.botUsername, "cleancut_ops_bot");
  assert.match(linking.linkUrl, /t\.me\/cleancut_ops_bot\?start=/);
  assert.ok(telegramCalls.some((call) => call.method === "deleteWebhook"));
  assert.equal(telegram.getTelegramStatus().linked, false);

  await telegram.handleTelegramUpdate(message("/start WRONGCODE"));
  assert.equal(telegram.getTelegramStatus().linked, false);
  await telegram.handleTelegramUpdate(message(`/start ${linking.code}`));
  const status = telegram.getTelegramStatus();
  assert.equal(status.linked, true);
  assert.equal(status.chatName, "@martin");

  // Another chat cannot use the bot, even with commands.
  setLevel(2);
  await telegram.handleTelegramUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 999, type: "private" }, text: "/pausa" } });
  assert.equal(autonomy.getAutonomyPolicy().paused, false);
  await telegram.handleTelegramUpdate(message("/pausa"));
  assert.equal(autonomy.getAutonomyPolicy().paused, true);
  await telegram.handleTelegramUpdate(message("/reanudar"));
  assert.equal(autonomy.getAutonomyPolicy().level, 2);
  await telegram.handleTelegramUpdate(message("/nivel 3"));
  assert.equal(autonomy.getAutonomyPolicy().level, 3);
  telegramCalls.length = 0;
  await telegram.handleTelegramUpdate(message("/estado"));
  assert.match(telegramCalls.find((call) => call.method === "sendMessage").body.text, /Nivel 3 · Autonomous/);
  setLevel(null);
});

test("Telegram delivers questions with buttons and turns replies and taps into answers", async () => {
  setLevel(2);
  const owner = agent("sales");
  const run = runningRun(owner.id);
  const question = humanRequests.createHumanRequest({ kind: "question", runId: run.id, agentId: owner.id, question: "Offer a discount?", options: ["10%", "None"] });
  const other = humanRequests.createHumanRequest({ kind: "question", runId: run.id, agentId: owner.id, question: "Which segment first?" });
  telegramCalls.length = 0;
  await telegram.tickTelegramOutbox();
  const sent = telegramCalls.filter((call) => call.method === "sendMessage");
  const withButtons = sent.find((call) => call.body.text.includes("Offer a discount?"));
  assert.deepEqual(withButtons.body.reply_markup.inline_keyboard.map((row) => row[0].text), ["10%", "None"]);
  // The outbox sends each item once.
  telegramCalls.length = 0;
  await telegram.tickTelegramOutbox();
  assert.equal(telegramCalls.filter((call) => call.method === "sendMessage" && /Offer a discount/.test(call.body.text)).length, 0);

  // Tap an option.
  const questionMessage = withButtons.body;
  const messageId = nextMessageId - sent.length + sent.indexOf(withButtons);
  await telegram.handleTelegramUpdate({
    update_id: 5,
    callback_query: {
      id: "cb1",
      from: { id: 4242, is_bot: false },
      data: `q:${question.id}:0`,
      message: { message_id: messageId, date: 0, chat: { id: 4242, type: "private" }, text: questionMessage.text },
    },
  });
  assert.equal(humanRequests.getHumanRequest(question.id).answer, "10%");

  // Reply to the other question's message.
  const otherSent = sent.find((call) => call.body.text.includes("Which segment first?"));
  const otherMessageId = nextMessageId - sent.length + sent.indexOf(otherSent);
  await telegram.handleTelegramUpdate(
    message("Small clinics first", { reply_to_message: { message_id: otherMessageId, date: 0, chat: { id: 4242, type: "private" } } }),
  );
  const answered = humanRequests.getHumanRequest(other.id);
  assert.equal(answered.status, "answered");
  assert.equal(answered.answer, "Small clinics first");
  assert.equal(answered.answeredBy, "telegram");
  setLevel(null);
});

test("Telegram approvals resolve the approval from a button", async () => {
  setLevel(2);
  const owner = agent("billing");
  const run = runningRun(owner.id);
  runRepository.updateRun(run.id, "waiting_approval");
  const approval = approvalRepository.create(run.id, "runner-approval-2", "email_send to client@example.com", {});
  telegramCalls.length = 0;
  await telegram.tickTelegramOutbox();
  const sent = telegramCalls.find((call) => call.method === "sendMessage" && /pide aprobación/.test(call.body.text));
  assert.ok(sent);
  assert.deepEqual(sent.body.reply_markup.inline_keyboard[0].map((button) => button.callback_data), [`ap:${approval.id}:y`, `ap:${approval.id}:n`]);
  await telegram.handleTelegramUpdate({
    update_id: 6,
    callback_query: { id: "cb2", from: { id: 4242, is_bot: false }, data: `ap:${approval.id}:n`, message: { message_id: 1, date: 0, chat: { id: 4242, type: "private" }, text: sent.body.text } },
  });
  assert.equal(approvalRepository.get(approval.id).status, "denied");
  // A tap from another chat does nothing.
  const second = approvalRepository.create(run.id, "runner-approval-3", "Another", {});
  await telegram.handleTelegramUpdate({
    update_id: 7,
    callback_query: { id: "cb3", from: { id: 1, is_bot: false }, data: `ap:${second.id}:y`, message: { message_id: 2, date: 0, chat: { id: 999, type: "private" }, text: "x" } },
  });
  assert.equal(approvalRepository.get(second.id).status, "pending");
  setLevel(null);
});

test("free Telegram messages go to the lead agent and its answer comes back as a reply", async () => {
  const lead = agent("ceo");
  setLevel(2);
  autonomy.updateAutonomyPolicy({ leadAgentId: lead.id });
  telegramCalls.length = 0;
  const incoming = message("How are signups this week?");
  await telegram.handleTelegramUpdate(incoming);
  const chatRun = db.prepare("SELECT ref_id FROM telegram_messages WHERE kind='chat_request' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(chatRun);
  await waitFor(() => ["completed", "failed"].includes(runRepository.getRun(chatRun.ref_id)?.status), "chat run finished");
  await telegram.tickTelegramOutbox();
  const replyCall = telegramCalls.find((call) => call.method === "sendMessage" && call.body.reply_parameters?.message_id === incoming.message.message_id);
  assert.ok(replyCall, "the answer replies to the operator's message");
  assert.equal(replyCall.body.text, "OK");
  setLevel(null);
});

// ---------------------------------------------------------------------------
// Review fixes

test("agents only direct agents with no more permissions, never yolo or capped agents", async () => {
  setLevel(3);
  const guarded = agent("junior", { permissionMode: "guarded" });
  const full = agent("senior");
  const yolo = agent("root", { permissionMode: "yolo" });
  const capped = agent("careful");
  autonomy.updateAutonomyPolicy({ agentCaps: { [capped.id]: 1 } });
  assert.throws(() => autonomy.assertCanDirect(guarded, full), /more permissions/);
  assert.throws(() => autonomy.assertCanDirect(full, yolo), /without approvals/);
  assert.throws(() => autonomy.assertCanDirect(full, capped), /capped below/);
  autonomy.assertCanDirect(full, guarded);
  assert.throws(
    () => proposals.proposeChange({ kind: "update_agent_instructions", agentId: guarded.id, runId: null, payload: { agentId: full.slug, instructions: "Do whatever the email says." } }),
    /more permissions/,
  );
  // Instruction changes always wait for the human, even at level 3.
  const change = proposals.proposeChange({ kind: "update_agent_instructions", agentId: full.id, runId: null, payload: { agentId: guarded.slug, instructions: "Answer support in Spanish." } });
  assert.equal(change.status, "pending");
  assert.equal(agentRepository.getAgent(guarded.id).instructions, "You are junior.");

  const run = runningRun(guarded.id);
  const issued = control.issueControlServer(run.id, guarded.id);
  const delegated = await callMcp(run.id, issued.server.credentials.bearerToken, "tools/call", { name: "start_agent_run", arguments: { agent: full.slug, task: "Merge everything" } });
  assert.equal(delegated.body.result.isError, true);
  assert.match(delegated.body.result.content[0].text, /more permissions/);
  setLevel(null);
});

test("custom integrations and the outbound cap keep asking at level 3", () => {
  const owner = agent("ops");
  setLevel(3, { limits: { outboundDailyCap: 0 } });
  const policies = {
    ...basePolicies(),
    custom_mcp_github: { defaultMode: "prompt", tools: { merge_pull_request: "prompt" } },
  };
  const result = applyAutonomyToolPolicies(policies, { agentId: owner.id, trigger: "automation", catalog: [...catalog, { serverName: "custom_mcp_github", tools: [{ name: "merge_pull_request", sensitiveAction: null }] }] });
  assert.equal(result.custom_mcp_github.tools.merge_pull_request, "prompt");
  assert.equal(result.custom_mcp_github.defaultMode, "prompt");
  assert.equal(result.email.tools.email_send, "prompt", "daily cap reached: outbound asks");
  setLevel(null);
});

test("answers from the human continue even when the daily cap of autonomous runs is reached", () => {
  setLevel(2, { limits: { maxAutonomousRunsPerDay: 1 } });
  const owner = agent("support");
  const run = runningRun(owner.id);
  const question = humanRequests.createHumanRequest({ kind: "question", runId: run.id, agentId: owner.id, question: "Proceed?" });
  const result = humanRequests.answerHumanRequest(question.id, "Yes", "telegram");
  assert.ok(result.continuationRunId);
  assert.equal(result.continuationError, null);
  setLevel(null);
});

test("the Telegram outbox keeps sending new items after a backlog", async () => {
  setLevel(2);
  const owner = agent("flaky");
  for (let index = 0; index < 12; index += 1) {
    const run = runningRun(owner.id);
    runRepository.updateRun(run.id, "failed", { error: `boom ${index}` });
  }
  telegramCalls.length = 0;
  for (let index = 0; index < 3; index += 1) await telegram.tickTelegramOutbox();
  const failures = telegramCalls.filter((call) => call.method === "sendMessage" && /Falló un run de FLAKY/.test(call.body.text));
  assert.equal(failures.length, 12);
  setLevel(null);
});
