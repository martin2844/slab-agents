import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

test("permission mode migration preserves legacy and custom behavior", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-permission-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
  });
  await knex.schema.createTable("agents", (table) => {
    table.text("id").primary();
    table.boolean("full_access").notNullable().defaultTo(false);
  });
  await knex.schema.createTable("agent_tool_policies", (table) => {
    table.text("agent_id").notNullable();
  });
  await knex("agents").insert([
    { id: "guarded", full_access: false },
    { id: "legacy-full", full_access: true },
    { id: "custom", full_access: false },
    { id: "custom-full", full_access: true },
  ]);
  await knex("agent_tool_policies").insert([
    { agent_id: "custom" },
    { agent_id: "custom-full" },
  ]);

  const migration = await import(
    "../db/migrations/202609010039_agent_permission_modes.cjs"
  );
  await migration.up(knex);

  const rows = await knex("agents")
    .select("id", "permission_mode", "full_access")
    .orderBy("id");
  assert.deepEqual(rows, [
    { id: "custom", permission_mode: "custom", full_access: 0 },
    { id: "custom-full", permission_mode: "custom", full_access: 0 },
    { id: "guarded", permission_mode: "guarded", full_access: 0 },
    { id: "legacy-full", permission_mode: "full", full_access: 1 },
  ]);
  await knex.destroy();
});
