/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("workspace_budget_policies", (table) => {
    table.integer("id").primary();
    table.integer("policy_version").notNullable().defaultTo(1);
    table.bigInteger("max_tokens_per_run");
    table.bigInteger("max_cost_micro_usd_per_run");
    table.bigInteger("daily_cost_micro_usd");
    table.bigInteger("monthly_cost_micro_usd");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("agent_budget_policies", (table) => {
    table
      .text("agent_id")
      .primary()
      .references("id")
      .inTable("agents")
      .onDelete("CASCADE");
    table.bigInteger("max_tokens_per_run");
    table.bigInteger("max_cost_micro_usd_per_run");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
  });
  await knex.schema.createTable("runtime_model_prices", (table) => {
    table.text("runtime_id").notNullable();
    table.text("model").notNullable();
    table.integer("version").notNullable().defaultTo(1);
    table.bigInteger("input_micro_usd_per_million").notNullable();
    table.bigInteger("cached_input_micro_usd_per_million").notNullable();
    table.bigInteger("output_micro_usd_per_million").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.primary(["runtime_id", "model"]);
  });
  await knex.schema.createTable("run_budget_reservations", (table) => {
    table
      .text("run_id")
      .primary()
      .references("id")
      .inTable("runs")
      .onDelete("CASCADE");
    table.text("runtime_id").notNullable();
    table.text("model").notNullable();
    table.text("status").notNullable();
    table.text("terminal_status");
    table.integer("policy_version").notNullable();
    table.integer("pricing_version");
    table.bigInteger("effective_max_tokens");
    table.bigInteger("effective_max_cost_micro_usd");
    table.bigInteger("reserved_cost_micro_usd").notNullable().defaultTo(0);
    table.bigInteger("input_rate_micro_usd_per_million");
    table.bigInteger("cached_input_rate_micro_usd_per_million");
    table.bigInteger("output_rate_micro_usd_per_million");
    table.bigInteger("actual_input_tokens").notNullable().defaultTo(0);
    table.bigInteger("actual_cached_input_tokens").notNullable().defaultTo(0);
    table.bigInteger("actual_output_tokens").notNullable().defaultTo(0);
    table.bigInteger("actual_total_tokens").notNullable().defaultTo(0);
    table.bigInteger("calculated_cost_micro_usd");
    table.bigInteger("provider_cost_micro_usd");
    table.bigInteger("actual_cost_micro_usd");
    table.text("reason");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.text("settled_at");
    table.text("exceeded_at");
  });
  await knex.schema.createTable("budget_usage_observations", (table) => {
    table
      .text("run_id")
      .notNullable()
      .references("id")
      .inTable("runs")
      .onDelete("CASCADE");
    table.text("event_key").notNullable();
    table.text("usage_scope").notNullable();
    table.bigInteger("input_tokens").notNullable().defaultTo(0);
    table.bigInteger("cached_input_tokens").notNullable().defaultTo(0);
    table.bigInteger("output_tokens").notNullable().defaultTo(0);
    table.bigInteger("total_tokens").notNullable().defaultTo(0);
    table.bigInteger("provider_cost_micro_usd");
    table.text("created_at").notNullable();
    table.primary(["run_id", "event_key"]);
  });
  const timestamp = new Date().toISOString();
  await knex("workspace_budget_policies").insert({
    id: 1,
    policy_version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("budget_usage_observations");
  await knex.schema.dropTableIfExists("run_budget_reservations");
  await knex.schema.dropTableIfExists("runtime_model_prices");
  await knex.schema.dropTableIfExists("agent_budget_policies");
  await knex.schema.dropTableIfExists("workspace_budget_policies");
};
