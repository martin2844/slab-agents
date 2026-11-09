exports.up = async function up(knex) {
  await knex.schema.alterTable("automations", (table) => {
    table.text("whatsapp_config_json");
    table.text("whatsapp_enabled_at");
  });
  await knex.schema.createTable("whatsapp_conversations", (table) => {
    table.text("account").notNullable();
    table.text("chat_id").notNullable();
    table
      .text("automation_id")
      .references("automations.id")
      .onDelete("SET NULL");
    table.integer("revision").notNullable().defaultTo(0);
    table.boolean("paused").notNullable().defaultTo(false);
    table.text("pause_reason");
    table.text("listening_since");
    table.text("active_run_id");
    table.text("updated_at").notNullable();
    table.primary(["account", "chat_id"]);
  });
  await knex.schema.createTable("whatsapp_messages", (table) => {
    table.increments("sequence");
    table.text("account").notNullable();
    table.text("message_id").notNullable();
    table.text("chat_id").notNullable();
    table.text("body").notNullable();
    table.boolean("from_me").notNullable();
    table.text("received_at").notNullable();
    table.bigInteger("timestamp_ms").notNullable();
    table.text("run_id");
    table.boolean("handled").notNullable().defaultTo(false);
    table.unique(["account", "message_id"]);
    table.index(["account", "chat_id", "handled", "run_id"]);
  });
  await knex.schema.createTable("whatsapp_threads", (table) => {
    table.text("account").notNullable();
    table.text("chat_id").notNullable();
    table
      .text("agent_id")
      .notNullable()
      .references("agents.id")
      .onDelete("CASCADE");
    table
      .text("thread_id")
      .notNullable()
      .references("threads.id")
      .onDelete("CASCADE");
    table.boolean("refresh_context").notNullable().defaultTo(false);
    table.primary(["account", "chat_id", "agent_id"]);
  });
  await knex.schema.createTable("whatsapp_batches", (table) => {
    table.text("run_id").primary().references("runs.id").onDelete("CASCADE");
    table.text("account").notNullable();
    table.text("chat_id").notNullable();
    table.text("automation_id").notNullable();
    table.integer("workflow_version").notNullable();
    table.integer("revision").notNullable();
    table.integer("integration_version").notNullable();
    table.text("status").notNullable().defaultTo("active");
  });
  await knex.schema.createTable("whatsapp_reply_receipts", (table) => {
    // A run gets at most one outbound attempt, including crash/timeout recovery.
    table.text("run_id").primary().references("runs.id").onDelete("CASCADE");
    table.text("status").notNullable();
    table.text("message_id");
    table.text("created_at").notNullable();
  });
};
exports.down = async function down(knex) {
  for (const name of [
    "whatsapp_reply_receipts",
    "whatsapp_batches",
    "whatsapp_threads",
    "whatsapp_messages",
    "whatsapp_conversations",
  ])
    await knex.schema.dropTable(name);
  await knex.schema.alterTable("automations", (table) => {
    table.dropColumn("whatsapp_config_json");
    table.dropColumn("whatsapp_enabled_at");
  });
};
