/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("settings"))) {
    await knex.schema.createTable("settings", (table) => {
      table.text("key").primary();
      table.text("value").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("agents"))) {
    await knex.schema.createTable("agents", (table) => {
      table.text("id").primary();
      table.text("name").notNullable();
      table.text("slug").notNullable().unique();
      table.text("role").notNullable();
      table.text("instructions").notNullable();
      table.text("runtime").notNullable().defaultTo("codex");
      table.text("model").notNullable().defaultTo("default");
      table.boolean("enabled").notNullable().defaultTo(true);
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("threads"))) {
    await knex.schema.createTable("threads", (table) => {
      table.text("id").primary();
      table
        .text("agent_id")
        .notNullable()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table.text("title").notNullable();
      table.text("runtime_thread_id");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.index(["agent_id", "updated_at"], "idx_threads_agent");
    });
  }

  if (!(await knex.schema.hasTable("automations"))) {
    await knex.schema.createTable("automations", (table) => {
      table.text("id").primary();
      table.text("name").notNullable();
      table
        .text("agent_id")
        .notNullable()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table.text("cron_expression");
      table.text("prompt").notNullable();
      table.boolean("enabled").notNullable().defaultTo(true);
      table.text("last_run_at");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("runs"))) {
    await knex.schema.createTable("runs", (table) => {
      table.text("id").primary();
      table.text("agent_id").notNullable().references("id").inTable("agents");
      table
        .text("thread_id")
        .references("id")
        .inTable("threads")
        .onDelete("SET NULL");
      table
        .text("automation_id")
        .references("id")
        .inTable("automations")
        .onDelete("SET NULL");
      table.text("status").notNullable();
      table.text("runtime").notNullable();
      table.text("started_at");
      table.text("completed_at");
      table.text("error");
      table.text("usage_json");
      table.index(["started_at"], "idx_runs_started");
    });
  }

  if (!(await knex.schema.hasTable("messages"))) {
    await knex.schema.createTable("messages", (table) => {
      table.text("id").primary();
      table
        .text("thread_id")
        .notNullable()
        .references("id")
        .inTable("threads")
        .onDelete("CASCADE");
      table
        .text("run_id")
        .references("id")
        .inTable("runs")
        .onDelete("SET NULL");
      table.text("role").notNullable();
      table.text("body").notNullable();
      table.text("created_at").notNullable();
      table.index(["thread_id", "created_at"], "idx_messages_thread");
    });
  }

  if (!(await knex.schema.hasTable("run_events"))) {
    await knex.schema.createTable("run_events", (table) => {
      table.text("id").primary();
      table
        .text("run_id")
        .notNullable()
        .references("id")
        .inTable("runs")
        .onDelete("CASCADE");
      table.text("type").notNullable();
      table.text("payload").notNullable();
      table.text("created_at").notNullable();
      table.index(["run_id", "created_at"], "idx_run_events_run");
    });
  }

  if (!(await knex.schema.hasTable("approvals"))) {
    await knex.schema.createTable("approvals", (table) => {
      table.text("id").primary();
      table
        .text("run_id")
        .notNullable()
        .references("id")
        .inTable("runs")
        .onDelete("CASCADE");
      table.text("runner_approval_id").notNullable();
      table.text("command").notNullable();
      table.text("details_json").notNullable().defaultTo("{}");
      table.text("status").notNullable().defaultTo("pending");
      table.text("created_at").notNullable();
      table.text("resolved_at");
      table.index(["status", "created_at"], "idx_approvals_status");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  for (const table of [
    "approvals",
    "run_events",
    "messages",
    "runs",
    "automations",
    "threads",
    "agents",
    "settings",
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
};
