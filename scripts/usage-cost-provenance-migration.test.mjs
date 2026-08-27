import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import knexFactory from "knex";

const require = createRequire(import.meta.url);
const migration = require("../db/migrations/202608270030_usage_cost_provenance.cjs");

test("usage provenance migration preserves Claude costs across rollback", async (t) => {
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  t.after(() => knex.destroy());

  await knex.schema.createTable("run_budget_reservations", (table) => {
    table.text("run_id").primary();
    table.text("runtime_id").notNullable();
    table.bigInteger("actual_total_tokens").notNullable().defaultTo(0);
    table.bigInteger("actual_input_tokens").notNullable().defaultTo(0);
    table.bigInteger("actual_cached_input_tokens").notNullable().defaultTo(0);
    table.bigInteger("actual_output_tokens").notNullable().defaultTo(0);
    table.integer("pricing_version");
    table.bigInteger("input_rate_micro_usd_per_million");
    table.bigInteger("cached_input_rate_micro_usd_per_million");
    table.bigInteger("output_rate_micro_usd_per_million");
    table.bigInteger("calculated_cost_micro_usd");
    table.bigInteger("provider_cost_micro_usd");
    table.bigInteger("actual_cost_micro_usd");
  });
  await knex.schema.createTable("budget_usage_observations", (table) => {
    table.text("run_id").notNullable();
    table.text("event_key").notNullable();
    table.text("usage_scope").notNullable();
    table.bigInteger("input_tokens").notNullable().defaultTo(0);
    table.bigInteger("cached_input_tokens").notNullable().defaultTo(0);
    table.bigInteger("output_tokens").notNullable().defaultTo(0);
    table.bigInteger("total_tokens").notNullable().defaultTo(0);
    table.bigInteger("provider_cost_micro_usd");
  });
  await knex("run_budget_reservations").insert({
    run_id: "claude-run",
    runtime_id: "claude",
    actual_total_tokens: 120,
    actual_input_tokens: 100,
    actual_cached_input_tokens: 0,
    actual_output_tokens: 20,
    provider_cost_micro_usd: 2500,
    actual_cost_micro_usd: 2500,
  });
  await knex("budget_usage_observations").insert([
    {
      run_id: "claude-run",
      event_key: "runner-1:6",
      usage_scope: "run_aggregate",
      input_tokens: 40,
      output_tokens: 10,
      total_tokens: 50,
      provider_cost_micro_usd: 1500,
    },
    {
      run_id: "claude-run",
      event_key: "runner-1:7",
      usage_scope: "run_aggregate",
      input_tokens: 60,
      output_tokens: 15,
      total_tokens: 75,
      provider_cost_micro_usd: 2000,
    },
    {
      run_id: "claude-run",
      event_key: "runner-2:1",
      usage_scope: "run_aggregate",
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25,
      provider_cost_micro_usd: 500,
    },
  ]);

  await migration.up(knex);
  assert.deepEqual(
    await knex("run_budget_reservations")
      .select(
        "actual_total_tokens",
        "provider_cost_micro_usd",
        "estimated_cost_micro_usd",
        "actual_cost_source",
      )
      .first(),
    {
      actual_total_tokens: 100,
      provider_cost_micro_usd: null,
      estimated_cost_micro_usd: 2500,
      actual_cost_source: "sdk_estimated",
    },
  );

  await migration.down(knex);
  assert.equal(
    (
      await knex("run_budget_reservations")
        .select("provider_cost_micro_usd")
        .first()
    ).provider_cost_micro_usd,
    2500,
  );
  assert.equal(
    (
      await knex("budget_usage_observations")
        .select("provider_cost_micro_usd")
        .where({ event_key: "runner-1:7" })
        .first()
    ).provider_cost_micro_usd,
    2000,
  );
});
