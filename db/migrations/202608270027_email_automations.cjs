/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("automations", "trigger_type"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("trigger_type").notNullable().defaultTo("schedule");
    });
  }
  if (!(await knex.schema.hasColumn("automations", "email_account_id"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("email_account_id");
    });
  }

  if (!(await knex.schema.hasTable("email_automation_feed_state"))) {
    await knex.schema.createTable("email_automation_feed_state", (table) => {
      table.text("id").primary();
      table.integer("cursor").notNullable().defaultTo(0);
      table.boolean("initialized").notNullable().defaultTo(false);
      table.text("last_polled_at");
      table.text("last_error");
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("email_automation_occurrences"))) {
    await knex.schema.createTable("email_automation_occurrences", (table) => {
      table.text("automation_id").notNullable();
      table.integer("inbound_event_id").notNullable();
      table.text("run_id").notNullable().unique();
      table.text("event_json").notNullable();
      table.text("status").notNullable().defaultTo("pending");
      table.text("skip_reason");
      table.text("created_at").notNullable();
      table.text("dispatched_at");
      table.primary(["automation_id", "inbound_event_id"]);
      table
        .foreign("automation_id")
        .references("automations.id")
        .onDelete("CASCADE");
    });
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_email_automation_occurrences_pending
      ON email_automation_occurrences(status, created_at)
    `);
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("email_automation_occurrences");
  await knex.schema.dropTableIfExists("email_automation_feed_state");
  for (const column of ["email_account_id", "trigger_type"]) {
    if (await knex.schema.hasColumn("automations", column)) {
      await knex.schema.alterTable("automations", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
