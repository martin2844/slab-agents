/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("system_update_policies", (table) => {
    table.integer("id").primary();
    table.integer("policy_version").notNullable().defaultTo(1);
    table.boolean("enabled").notNullable().defaultTo(false);
    table.integer("check_hour_utc").notNullable().defaultTo(3);
    table.text("last_scheduled_at");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
  });

  await knex.schema.createTable("system_update_requests", (table) => {
    table.text("id").primary();
    table.text("action").notNullable();
    table.text("channel").notNullable();
    table.text("target");
    table.text("source").notNullable();
    table.text("state").notNullable();
    table.text("requested_at").notNullable();
    table.text("expires_at").notNullable();
    table.text("started_at");
    table.text("completed_at");
    table.text("result_json");
    table.text("error_code");
    table.text("error_message");
    table.text("automatic_decision");
    table.text("scheduled_for");
    table
      .text("parent_request_id")
      .references("id")
      .inTable("system_update_requests")
      .onDelete("SET NULL");
    table
      .text("follow_up_request_id")
      .references("id")
      .inTable("system_update_requests")
      .onDelete("SET NULL");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.index(["state", "created_at"], "idx_system_update_requests_state");
    table.index(
      ["source", "action", "automatic_decision", "created_at"],
      "idx_system_update_requests_automatic",
    );
    table.index(
      ["source", "scheduled_for", "requested_at"],
      "idx_system_update_requests_schedule",
    );
  });

  const timestamp = new Date().toISOString();
  await knex("system_update_policies").insert({
    id: 1,
    policy_version: 1,
    enabled: false,
    check_hour_utc: 3,
    created_at: timestamp,
    updated_at: timestamp,
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("system_update_requests");
  await knex.schema.dropTableIfExists("system_update_policies");
};
