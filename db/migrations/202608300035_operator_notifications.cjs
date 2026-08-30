/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("operator_notification_settings", (table) => {
    table.integer("id").primary();
    table.boolean("enabled").notNullable().defaultTo(false);
    table.text("enabled_at");
    table.text("recipient_email").notNullable().defaultTo("");
    table.text("account_id");
    table.text("profile_id");
    table.text("token_id");
    table.text("token_prefix");
    table.text("token_created_at");
    table.text("last_tested_at");
    table.text("last_error");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
  });

  await knex.schema.createTable("operator_notification_outbox", (table) => {
    table.text("id").primary();
    table.text("dedupe_key").notNullable().unique();
    table.text("kind").notNullable();
    table.text("resource_type").notNullable();
    table.text("resource_id").notNullable();
    table.text("subject").notNullable();
    table.text("body").notNullable();
    table.text("status").notNullable().defaultTo("pending");
    table.integer("attempt_count").notNullable().defaultTo(0);
    table.text("next_attempt_at").notNullable();
    table.text("claimed_at");
    table.text("last_error");
    table.text("created_at").notNullable();
    table.text("sent_at");
    table.index(["status", "next_attempt_at"], "idx_operator_notifications_due");
  });

  const timestamp = new Date().toISOString();
  await knex("operator_notification_settings").insert({
    id: 1,
    enabled: false,
    recipient_email: "",
    created_at: timestamp,
    updated_at: timestamp,
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("operator_notification_outbox");
  await knex.schema.dropTableIfExists("operator_notification_settings");
};
