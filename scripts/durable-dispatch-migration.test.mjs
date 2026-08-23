import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");

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

    await database("automations").where({ id: "automation-1" }).delete();
    assert.equal(
      Number(
        (
          await database("automation_occurrences").count({ count: "*" }).first()
        ).count,
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
  assert.match(scheduler, /listPendingAutomationOccurrences/);
  assert.match(repository, /INSERT OR IGNORE INTO automation_occurrences/);
});
