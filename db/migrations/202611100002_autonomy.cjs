// Autonomy levels, Telegram, questions to the human, follow-ups, and proposals.
// Additive only: an install without autonomy settings behaves as before (level 1).
exports.up = async function up(knex) {
  await knex.schema.createTable("autonomy_events", (table) => {
    table.text("id").primary();
    table.text("kind").notNullable();
    table.text("actor").notNullable();
    table.text("summary").notNullable();
    table.text("payload_json");
    table.text("created_at").notNullable();
    table.index(["created_at"], "idx_autonomy_events_created");
  });

  await knex.schema.createTable("human_requests", (table) => {
    table.text("id").primary();
    table.text("kind").notNullable(); // question | update
    table.text("run_id");
    table.text("agent_id");
    table.text("thread_id");
    table.text("issue_key");
    table.text("question").notNullable();
    table.text("options_json");
    table.text("urgency").notNullable().defaultTo("normal");
    table.text("status").notNullable(); // pending | answered | expired | sent
    table.text("answer");
    table.text("answered_by");
    table.text("default_answer");
    table.text("expires_at");
    table.text("continuation_run_id");
    table.text("created_at").notNullable();
    table.text("answered_at");
    table.index(["status", "expires_at"], "idx_human_requests_status");
  });

  await knex.schema.createTable("agent_wakeups", (table) => {
    table.text("id").primary();
    table.text("agent_id").notNullable();
    table.text("due_at").notNullable();
    table.text("note").notNullable();
    table.text("issue_key");
    table.text("source_run_id");
    table.integer("depth").notNullable().defaultTo(0);
    table.text("status").notNullable(); // pending | fired | cancelled | skipped
    table.text("fired_run_id");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.index(["status", "due_at"], "idx_agent_wakeups_due");
  });

  await knex.schema.createTable("autonomy_proposals", (table) => {
    table.text("id").primary();
    table.text("kind").notNullable();
    table.text("agent_id");
    table.text("run_id");
    table.text("target_id");
    table.text("summary").notNullable();
    table.text("payload_json").notNullable();
    table.text("status").notNullable(); // pending | applied | rejected | failed
    table.text("result_id");
    table.text("error");
    table.text("decided_by");
    table.text("created_at").notNullable();
    table.text("decided_at");
    table.index(["status", "created_at"], "idx_autonomy_proposals_status");
  });

  await knex.schema.createTable("run_lineage", (table) => {
    table.text("run_id").primary();
    table.text("parent_run_id");
    table.integer("depth").notNullable().defaultTo(0);
    table.text("origin").notNullable(); // delegate | followup | question | planning | telegram
    table.text("created_at").notNullable();
    table.index(["created_at"], "idx_run_lineage_created");
  });

  await knex.schema.createTable("run_control_tokens", (table) => {
    table.text("run_id").primary();
    table.text("agent_id").notNullable();
    table.text("token_hash").notNullable();
    table.text("created_at").notNullable();
  });

  await knex.schema.createTable("telegram_messages", (table) => {
    table.text("id").primary();
    table.text("chat_id").notNullable();
    table.integer("message_id").notNullable();
    table.text("kind").notNullable();
    table.text("ref_id");
    table.text("created_at").notNullable();
    table.unique(["chat_id", "message_id"]);
    table.index(["kind", "ref_id"], "idx_telegram_messages_ref");
  });

  await knex.schema.createTable("approval_escalations", (table) => {
    table.text("approval_id").primary();
    table.text("reminded_at");
    table.text("resolved_at");
    table.text("resolution");
  });
};

exports.down = async function down(knex) {
  for (const table of [
    "approval_escalations",
    "telegram_messages",
    "run_control_tokens",
    "run_lineage",
    "autonomy_proposals",
    "agent_wakeups",
    "human_requests",
    "autonomy_events",
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
};
