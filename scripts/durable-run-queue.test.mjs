import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";

import { RunQueueRepository } from "../lib/repositories/run-queue-repository.ts";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      thread_id TEXT,
      trigger TEXT NOT NULL DEFAULT 'manual',
      mode TEXT NOT NULL DEFAULT 'chat',
      status TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'codex',
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      runner_run_id TEXT,
      runner_retry_at TEXT
    );
  `);
  const insert = database.prepare(
    `INSERT INTO runs
      (id,agent_id,thread_id,trigger,mode,status,created_at,queued_at,lease_owner,lease_expires_at,attempt_count,runner_run_id,runner_retry_at,error)
     VALUES (@id,@agentId,@threadId,@trigger,@mode,@status,@createdAt,@queuedAt,@leaseOwner,@leaseExpiresAt,@attemptCount,@runnerRunId,@runnerRetryAt,@error)`,
  );
  const addRun = (input = {}) => {
    const createdAt = input.createdAt ?? "2026-08-23T12:00:00.000Z";
    insert.run({
      id: input.id ?? crypto.randomUUID(),
      agentId: input.agentId ?? "sales",
      threadId: input.threadId ?? null,
      trigger: input.trigger ?? "manual",
      mode: input.mode ?? "chat",
      status: input.status ?? "queued",
      createdAt,
      queuedAt: input.queuedAt ?? createdAt,
      leaseOwner: input.leaseOwner ?? null,
      leaseExpiresAt: input.leaseExpiresAt ?? null,
      attemptCount: input.attemptCount ?? 0,
      runnerRunId: input.runnerRunId ?? null,
      runnerRetryAt: input.runnerRetryAt ?? null,
      error: input.error ?? null,
    });
  };
  return { database, addRun };
}

test("durable admission preserves FIFO for one agent", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  addRun({ id: "run-1", createdAt: "2026-08-23T12:00:00.000Z" });
  addRun({ id: "run-2", createdAt: "2026-08-23T12:00:01.000Z" });
  const queue = new RunQueueRepository(database, {
    ownerId: "process-a",
    pollMs: 5,
    heartbeatMs: 1_000,
  });

  const first = queue.acquire("run-1");
  const second = queue.acquire("run-2");
  assert.equal(first.queued, false);
  assert.equal(second.queued, true);
  assert.equal(second.blockedByRunId, "run-1");
  const firstLease = await first.ready;
  assert.ok(firstLease);
  database.prepare("UPDATE runs SET status='completed' WHERE id='run-1'").run();
  firstLease.release();
  const secondLease = await second.ready;
  assert.ok(secondLease);
  secondLease.release();

  const attempts = database
    .prepare("SELECT id,attempt_count FROM runs ORDER BY rowid")
    .all();
  assert.deepEqual(attempts, [
    { id: "run-1", attempt_count: 1 },
    { id: "run-2", attempt_count: 1 },
  ]);
});

test("different agents acquire independent leases", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  addRun({ id: "sales-run", agentId: "sales" });
  addRun({ id: "coo-run", agentId: "coo" });
  const queue = new RunQueueRepository(database, { ownerId: "process-a" });
  const [sales, coo] = await Promise.all([
    queue.acquire("sales-run").ready,
    queue.acquire("coo-run").ready,
  ]);
  assert.ok(sales);
  assert.ok(coo);
  sales.release();
  coo.release();
});

test("startup recovery requeues abandoned work and fails abandoned approvals", (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  const expired = "2026-08-23T11:59:00.000Z";
  addRun({
    id: "retry-run",
    status: "running",
    leaseOwner: "dead-process",
    leaseExpiresAt: expired,
    attemptCount: 1,
  });
  addRun({
    id: "approval-run",
    status: "waiting_approval",
    leaseOwner: "dead-process",
    leaseExpiresAt: expired,
    attemptCount: 1,
    runnerRunId: "runner-approval",
  });
  addRun({
    id: "exhausted-run",
    status: "running",
    leaseOwner: "dead-process",
    leaseExpiresAt: expired,
    attemptCount: 3,
  });
  addRun({
    id: "queued-run",
    status: "queued",
    leaseOwner: "dead-process",
    leaseExpiresAt: expired,
  });
  const queue = new RunQueueRepository(database, {
    ownerId: "new-process",
    now: () => new Date("2026-08-23T12:00:00.000Z"),
  });
  const recovery = queue.recoverExpired();
  assert.deepEqual(recovery.requeued, ["retry-run", "approval-run"]);
  assert.deepEqual(recovery.failed, ["exhausted-run"]);
  assert.deepEqual(recovery.releasedQueued, ["queued-run"]);

  const statuses = database
    .prepare("SELECT id,status,error,lease_owner FROM runs ORDER BY rowid")
    .all();
  assert.equal(statuses[0].status, "queued");
  assert.equal(statuses[0].lease_owner, null);
  assert.equal(statuses[1].status, "queued");
  assert.equal(statuses[1].lease_owner, null);
  assert.equal(statuses[2].status, "failed");
  assert.match(statuses[2].error, /3 attempts/);
  assert.equal(statuses[3].status, "queued");
  assert.equal(statuses[3].lease_owner, null);
});

test("maintenance persists queued intent until dispatch resumes", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  addRun({ id: "maintenance-run" });
  database
    .prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)")
    .run("system_maintenance_mode", "on", "2026-08-23T12:00:00.000Z");
  const queue = new RunQueueRepository(database, {
    ownerId: "process-a",
    pollMs: 5,
  });
  const admission = queue.acquire("maintenance-run");
  assert.equal(admission.queued, true);
  assert.equal(admission.reason, "maintenance");
  database
    .prepare(
      "UPDATE settings SET value='off' WHERE key='system_maintenance_mode'",
    )
    .run();
  const lease = await admission.ready;
  assert.ok(lease);
  lease.release();
});

test("maintenance atomically defers an admitted run before runtime starts", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  addRun({ id: "preflight-run" });
  const queue = new RunQueueRepository(database, { ownerId: "process-a" });
  const lease = await queue.acquire("preflight-run").ready;
  assert.ok(lease);
  database
    .prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)")
    .run("system_maintenance_mode", "on", "2026-08-23T12:00:00.000Z");
  assert.equal(lease.begin(), "maintenance");
  assert.equal(
    database.prepare("SELECT status FROM runs WHERE id=?").get("preflight-run")
      .status,
    "queued",
  );
  database
    .prepare(
      "UPDATE settings SET value='off' WHERE key='system_maintenance_mode'",
    )
    .run();
  assert.equal(lease.begin(), "started");
  lease.release();
});

test("runner reconnect backoff delays dispatch and clears its transient error on begin", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  let current = new Date("2026-08-23T12:00:00.000Z");
  addRun({
    id: "reconnect-run",
    runnerRunId: "runner-reconnect",
    runnerRetryAt: "2026-08-23T12:00:30.000Z",
    error: "Runner event stream was interrupted.",
  });
  const queue = new RunQueueRepository(database, {
    ownerId: "process-a",
    now: () => current,
  });
  assert.deepEqual(queue.listQueuedRunIds(100, 0), []);
  current = new Date("2026-08-23T12:00:31.000Z");
  assert.deepEqual(queue.listQueuedRunIds(100, 0), ["reconnect-run"]);
  const lease = await queue.acquire("reconnect-run").ready;
  assert.ok(lease);
  assert.equal(lease.begin(), "started");
  assert.deepEqual(
    database
      .prepare("SELECT status,error,runner_retry_at FROM runs WHERE id=?")
      .get("reconnect-run"),
    { status: "running", error: null, runner_retry_at: null },
  );
  lease.release();
});

test("an expired owner is fenced before a recovered owner continues", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  addRun({ id: "fenced-run" });
  let current = new Date("2026-08-23T12:00:00.000Z");
  const ownerA = new RunQueueRepository(database, {
    ownerId: "process-a",
    leaseMs: 1_000,
    heartbeatMs: 60_000,
    now: () => current,
  });
  const first = await ownerA.acquire("fenced-run").ready;
  assert.ok(first);
  database
    .prepare("UPDATE runs SET status='running' WHERE id='fenced-run'")
    .run();

  current = new Date("2026-08-23T12:00:02.000Z");
  const ownerB = new RunQueueRepository(database, {
    ownerId: "process-b",
    leaseMs: 1_000,
    heartbeatMs: 60_000,
    now: () => current,
  });
  assert.deepEqual(ownerB.recoverExpired().requeued, ["fenced-run"]);
  const recovered = await ownerB.acquire("fenced-run").ready;
  assert.ok(recovered);
  assert.equal(first.isCurrent(), false);
  assert.equal(recovered.isCurrent(), true);
  first.release();
  recovered.release();
});

test("WhatsApp approvals and queued follow-ups only block their own conversation without browser activity", async (t) => {
  const { database, addRun } = fixture();
  const pending = [];
  const leases = [];
  t.after(async () => {
    database.prepare("UPDATE runs SET status='cancelled'").run();
    for (const promise of pending) {
      const lease = await promise;
      lease?.release();
    }
    for (const lease of leases) lease.release();
    database.close();
  });
  const queueA = new RunQueueRepository(database, {
    ownerId: "worker-a",
    pollMs: 5,
  });
  const queueB = new RunQueueRepository(database, {
    ownerId: "worker-b",
    pollMs: 5,
  });
  addRun({ id: "approval", trigger: "whatsapp", threadId: "chat-a" });
  const first = await queueA.acquire("approval").ready;
  leases.push(first);
  assert.equal(first.begin(), "started");
  database
    .prepare("UPDATE runs SET status='waiting_approval' WHERE id='approval'")
    .run();
  addRun({ id: "followup-a", trigger: "whatsapp", threadId: "chat-a" });
  addRun({ id: "second-followup-a", trigger: "whatsapp", threadId: "chat-a" });
  const followup = queueB.acquire("followup-a");
  pending.push(followup.ready);
  assert.equal(followup.blockedByRunId, "approval");
  for (const [id, threadId] of [
    ["reply-b", "chat-b"],
    ["reply-c", "chat-c"],
  ]) {
    addRun({ id, trigger: "whatsapp", threadId });
    const admission = queueB.acquire(id);
    pending.push(admission.ready);
    assert.equal(admission.queued, false);
    const lease = await admission.ready;
    leases.push(lease);
    assert.equal(lease.begin(), "started");
    database.prepare("UPDATE runs SET status='completed' WHERE id=?").run(id);
    lease.release();
  }
  assert.equal(
    database.prepare("SELECT status FROM runs WHERE id='approval'").get()
      .status,
    "waiting_approval",
  );
  database
    .prepare("UPDATE runs SET status='cancelled' WHERE id='approval'")
    .run();
  first.release();
  // Reverse admission order must still respect FIFO inside chat A.
  const second = queueB.acquire("second-followup-a");
  pending.push(second.ready);
  assert.equal(second.queued, true);
  assert.equal(second.blockedByRunId, "followup-a");
  const followupLease = await followup.ready;
  assert.ok(followupLease);
  leases.push(followupLease);
  assert.equal(followupLease.begin(), "started");
  database
    .prepare("UPDATE runs SET status='completed' WHERE id='followup-a'")
    .run();
  followupLease.release();
  const last = await second.ready;
  leases.push(last);
  assert.equal(last.begin(), "started");
});

test("WhatsApp and ordinary work have independent queues but manual turns in the same chat remain exclusive", async (t) => {
  const { database, addRun } = fixture();
  const pending = [];
  t.after(async () => {
    database.prepare("UPDATE runs SET status='cancelled'").run();
    for (const promise of pending) (await promise)?.release();
    database.close();
  });
  const a = new RunQueueRepository(database, {
    ownerId: "worker-a",
    pollMs: 5,
  });
  const b = new RunQueueRepository(database, {
    ownerId: "worker-b",
    pollMs: 5,
  });
  addRun({ id: "ordinary", threadId: "work-chat" });
  addRun({ id: "ordinary-next", threadId: "other-work-chat" });
  const ordinary = a.acquire("ordinary");
  pending.push(ordinary.ready);
  assert.equal((await ordinary.ready).begin(), "started");
  addRun({ id: "whatsapp", trigger: "whatsapp", threadId: "wa-chat" });
  const whatsapp = b.acquire("whatsapp");
  pending.push(whatsapp.ready);
  assert.equal(whatsapp.queued, false);
  assert.equal((await whatsapp.ready).begin(), "started");
  const next = b.acquire("ordinary-next");
  pending.push(next.ready);
  assert.equal(next.blockedByRunId, "ordinary");
  database
    .prepare("UPDATE runs SET status='completed' WHERE id='ordinary'")
    .run();
  (await ordinary.ready).release();
  assert.equal((await next.ready).begin(), "started");
  database
    .prepare("UPDATE runs SET status='completed' WHERE id='ordinary-next'")
    .run();
  (await next.ready).release();
  addRun({ id: "manual-wa", threadId: "wa-chat" });
  const manual = a.acquire("manual-wa");
  pending.push(manual.ready);
  assert.equal(manual.blockedByRunId, "whatsapp");
  database
    .prepare("UPDATE runs SET status='completed' WHERE id='whatsapp'")
    .run();
  (await whatsapp.ready).release();
  assert.equal((await manual.ready).begin(), "started");
  addRun({ id: "wa-after-manual", trigger: "whatsapp", threadId: "wa-chat" });
  const blocked = b.acquire("wa-after-manual");
  pending.push(blocked.ready);
  assert.equal(blocked.blockedByRunId, "manual-wa");
});
