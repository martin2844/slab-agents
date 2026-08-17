/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("work_coordination_items"))) {
    await knex.schema.createTable("work_coordination_items", (table) => {
      table.text("issue_key").primary();
      table.text("project_key").notNullable();
      table.text("assignee");
      table.text("semantic_status").notNullable();
      table.text("remote_updated_at");
      table.text("labels_json").notNullable().defaultTo("[]");
      table.text("first_seen_at").notNullable();
      table.text("last_seen_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("work_agent_threads"))) {
    await knex.schema.createTable("work_agent_threads", (table) => {
      table.text("issue_key").notNullable();
      table
        .text("agent_id")
        .notNullable()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table
        .text("thread_id")
        .notNullable()
        .references("id")
        .inTable("threads")
        .onDelete("CASCADE");
      table.text("created_at").notNullable();
      table.primary(["issue_key", "agent_id"]);
      table.unique(["thread_id"]);
    });
  }

  if (!(await knex.schema.hasTable("work_coordination_events"))) {
    await knex.schema.createTable("work_coordination_events", (table) => {
      table.text("id").primary();
      table.text("dedupe_key").notNullable().unique();
      table.text("issue_key").notNullable();
      table.text("type").notNullable();
      table
        .text("agent_id")
        .references("id")
        .inTable("agents")
        .onDelete("SET NULL");
      table.text("comment_id");
      table
        .text("run_id")
        .references("id")
        .inTable("runs")
        .onDelete("SET NULL");
      table.text("error");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.index(["issue_key", "created_at"], "idx_work_events_issue");
      table.index(["run_id"], "idx_work_events_run");
    });
  }

  if (!(await knex.schema.hasTable("work_coordination_comments"))) {
    await knex.schema.createTable("work_coordination_comments", (table) => {
      table.text("comment_id").primary();
      table.text("issue_key").notNullable();
      table.text("first_seen_at").notNullable();
      table.index(["issue_key"], "idx_work_comments_issue");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("work_coordination_comments");
  await knex.schema.dropTableIfExists("work_coordination_events");
  await knex.schema.dropTableIfExists("work_agent_threads");
  await knex.schema.dropTableIfExists("work_coordination_items");
};
