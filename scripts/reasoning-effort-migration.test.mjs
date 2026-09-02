import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
import migration from "../db/migrations/202609020040_agent_reasoning_effort.cjs";

test("reasoning effort migration backfills existing agents and runs", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "slab-effort-migration-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "workspace.db") },
    useNullAsDefault: true,
  });
  t.after(() => knex.destroy());

  await knex.schema.createTable("agents", (table) => {
    table.text("id").primary();
  });
  await knex.schema.createTable("runs", (table) => {
    table.text("id").primary();
  });
  await knex("agents").insert({ id: "agent-existing" });
  await knex("runs").insert({ id: "run-existing" });

  await migration.up(knex);

  assert.equal(
    (await knex("agents").where({ id: "agent-existing" }).first())
      .reasoning_effort,
    "default",
  );
  assert.equal(
    (await knex("runs").where({ id: "run-existing" }).first()).reasoning_effort,
    "default",
  );
});
