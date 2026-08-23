import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
const require = createRequire(import.meta.url);

test("durable dispatch schema persists leases and unique automation occurrences", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-dispatch-"));
  const database = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "workspace.db") },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
    pool: {
      afterCreate(connection, done) {
        connection.pragma("foreign_keys = ON");
        done(null, connection);
      },
    },
  });
  try {
    await database.migrate.latest();
    const runColumns = new Set(
      (await database("runs").columnInfo()) &&
        Object.keys(await database("runs").columnInfo()),
    );
    for (const column of [
      "created_at",
      "queued_at",
      "lease_owner",
      "lease_expires_at",
      "attempt_count",
      "runner_run_id",
      "runner_event_id",
      "runner_retry_at",
    ]) {
      assert.ok(runColumns.has(column), `${column} must be persisted`);
    }

    const timestamp = "2026-08-23T08:00:00.000Z";
    await database("agents").insert({
      id: "agent-1",
      name: "COO",
      slug: "coo",
      role: "Operations",
      instructions: "Operate",
      runtime: "codex",
      model: "default",
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database("automations").insert({
      id: "automation-1",
      name: "Daily review",
      agent_id: "agent-1",
      cron_expression: "0 8 * * *",
      prompt: "Review operations",
      mode: "review",
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });
    const occurrence = {
      automation_id: "automation-1",
      scheduled_for: timestamp,
      run_id: "run-1",
      status: "pending",
      created_at: timestamp,
    };
    await database("automation_occurrences").insert(occurrence);
    await database("automation_occurrences")
      .insert({ ...occurrence, run_id: "run-2" })
      .onConflict(["automation_id", "scheduled_for"])
      .ignore();
    const rows = await database("automation_occurrences");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].run_id, "run-1");
    assert.equal(rows[0].status, "pending");

    await database("runs").insert({
      id: "approval-run",
      agent_id: "agent-1",
      status: "running",
      runtime: "codex",
      trigger: "manual",
      mode: "task",
      run_instructions: "Execute",
      created_at: timestamp,
      queued_at: timestamp,
    });
    const approval = {
      id: "approval-1",
      run_id: "approval-run",
      runner_approval_id: "runner-approval-1",
      command: "Test",
      details_json: "{}",
      status: "pending",
      created_at: timestamp,
    };
    await database("approvals").insert(approval);
    await assert.rejects(
      database("approvals").insert({ ...approval, id: "approval-2" }),
      /unique/i,
    );

    await database("automations").where({ id: "automation-1" }).delete();
    assert.equal(
      Number(
        (await database("automation_occurrences").count({ count: "*" }).first())
          .count,
      ),
      0,
    );
  } finally {
    await database.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

test("scheduled run creation is transactional and pending occurrences recover", async () => {
  const [service, scheduler, repository] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile("lib/run-service.ts", "utf8"),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile("lib/scheduler.ts", "utf8"),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile("lib/repository.ts", "utf8"),
    ),
  ]);
  assert.match(service, /repository\.transaction\(\(\) =>/);
  assert.match(service, /claimAutomationOccurrence/);
  assert.match(service, /markAutomationOccurrenceDispatched/);
  assert.match(service, /if \(!lease\.isCurrent\(\)\) return/);
  assert.match(service, /runnerEventCursor/);
  assert.match(service, /runtimeResumed: runner\.resumed/);
  assert.match(scheduler, /listPendingAutomationOccurrences/);
  assert.match(repository, /INSERT OR IGNORE INTO automation_occurrences/);
});

test("runner cursor migration preserves a resolved approval over an older pending replay", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "slab-approval-migration-"),
  );
  const database = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "workspace.db") },
    useNullAsDefault: true,
  });
  try {
    await database.schema.createTable("runs", (table) => {
      table.text("id").primary();
    });
    await database.schema.createTable("approvals", (table) => {
      table.text("id").primary();
      table.text("run_id").notNullable();
      table.text("runner_approval_id").notNullable();
      table.text("status").notNullable();
      table.text("resolved_at");
    });
    await database("runs").insert({ id: "run-1" });
    await database("approvals").insert([
      {
        id: "pending-old",
        run_id: "run-1",
        runner_approval_id: "runner-approval-1",
        status: "pending",
        resolved_at: null,
      },
      {
        id: "approved-new",
        run_id: "run-1",
        runner_approval_id: "runner-approval-1",
        status: "approved",
        resolved_at: "2026-08-23T12:00:00.000Z",
      },
    ]);

    const migration = require(
      path.join(migrationDirectory, "202608240017_runner_resume_cursor.cjs"),
    );
    await migration.up(database);

    const approvals = await database("approvals");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].id, "approved-new");
    assert.equal(approvals[0].status, "approved");
    await assert.rejects(
      database("approvals").insert({
        id: "duplicate",
        run_id: "run-1",
        runner_approval_id: "runner-approval-1",
        status: "pending",
      }),
      /unique/i,
    );
  } finally {
    await database.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
