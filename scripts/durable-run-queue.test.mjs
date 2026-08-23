import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";

import { DurableRunQueue } from "../lib/durable-run-queue.ts";

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
      status TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'codex',
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insert = database.prepare(
    `INSERT INTO runs
      (id,agent_id,status,created_at,queued_at,lease_owner,lease_expires_at,attempt_count)
     VALUES (@id,@agentId,@status,@createdAt,@queuedAt,@leaseOwner,@leaseExpiresAt,@attemptCount)`,
  );
  const addRun = (input = {}) => {
    const createdAt = input.createdAt ?? "2026-08-23T12:00:00.000Z";
    insert.run({
      id: input.id ?? crypto.randomUUID(),
      agentId: input.agentId ?? "sales",
      status: input.status ?? "queued",
      createdAt,
      queuedAt: input.queuedAt ?? createdAt,
      leaseOwner: input.leaseOwner ?? null,
      leaseExpiresAt: input.leaseExpiresAt ?? null,
      attemptCount: input.attemptCount ?? 0,
    });
  };
  return { database, addRun };
}

test("durable admission preserves FIFO for one agent", async (t) => {
  const { database, addRun } = fixture();
  t.after(() => database.close());
  addRun({ id: "run-1", createdAt: "2026-08-23T12:00:00.000Z" });
  addRun({ id: "run-2", createdAt: "2026-08-23T12:00:01.000Z" });
  const queue = new DurableRunQueue(database, {
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
  database
    .prepare("UPDATE runs SET status='completed' WHERE id='run-1'")
    .run();
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
  const queue = new DurableRunQueue(database, { ownerId: "process-a" });
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
  const queue = new DurableRunQueue(database, {
    ownerId: "new-process",
    now: () => new Date("2026-08-23T12:00:00.000Z"),
  });
  const recovery = queue.recoverExpired();
  assert.deepEqual(recovery.requeued, ["retry-run"]);
  assert.deepEqual(recovery.failed, ["approval-run", "exhausted-run"]);
  assert.deepEqual(recovery.releasedQueued, ["queued-run"]);

  const statuses = database
    .prepare("SELECT id,status,error,lease_owner FROM runs ORDER BY rowid")
    .all();
  assert.equal(statuses[0].status, "queued");
  assert.equal(statuses[0].lease_owner, null);
  assert.equal(statuses[1].status, "failed");
  assert.match(statuses[1].error, /waiting for approval/);
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
  const queue = new DurableRunQueue(database, {
    ownerId: "process-a",
    pollMs: 5,
  });
  const admission = queue.acquire("maintenance-run");
  assert.equal(admission.queued, true);
  assert.equal(admission.reason, "maintenance");
  database
    .prepare("UPDATE settings SET value='off' WHERE key='system_maintenance_mode'")
    .run();
  const lease = await admission.ready;
  assert.ok(lease);
  lease.release();
});
