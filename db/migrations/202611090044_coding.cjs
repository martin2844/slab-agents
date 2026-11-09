exports.up = async function up(knex) {
  await knex.schema.createTable("code_repositories", (table) => {
    table.text("id").primary();
    table
      .text("source_app_id")
      .notNullable()
      .references("id")
      .inTable("github_source_apps")
      .onDelete("RESTRICT");
    table.text("owner").notNullable();
    table.text("name").notNullable();
    table.text("default_branch").notNullable();
    table.text("setup_command");
    table.text("test_command");
    table.text("lint_command");
    table.text("typecheck_command");
    table.text("setup_notes").notNullable().defaultTo("");
    table.text("work_project_key");
    table.integer("enabled").notNullable().defaultTo(1);
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["owner", "name"]);
  });

  await knex.schema.createTable("code_runs", (table) => {
    table.text("id").primary();
    table.integer("number").notNullable().unique();
    table.text("issue_key").notNullable();
    table.text("title").notNullable();
    table
      .text("repository_id")
      .notNullable()
      .references("id")
      .inTable("code_repositories")
      .onDelete("RESTRICT");
    table.text("status").notNullable();
    table.text("current_stage").notNullable();
    table.text("workspace_id").notNullable();
    table.text("workspace_status").notNullable().defaultTo("pending");
    table.text("branch").notNullable();
    table.text("base_sha");
    table.text("head_sha");
    table.text("note").notNullable().defaultTo("");
    table.integer("pr_number");
    table.text("pr_url");
    table.text("pr_state");
    table.text("ci_state");
    table.text("pr_checked_at");
    table.text("last_published_sha");
    table.text("published_at");
    table.text("error");
    table.text("started_at").notNullable();
    table.text("finished_at");
    table.text("updated_at").notNullable();
    table.index(["status", "started_at"], "idx_code_runs_status");
    table.index(["issue_key"], "idx_code_runs_issue");
  });

  await knex.schema.createTable("code_run_stages", (table) => {
    table.text("id").primary();
    table
      .text("code_run_id")
      .notNullable()
      .references("id")
      .inTable("code_runs")
      .onDelete("CASCADE");
    table.text("stage").notNullable();
    table.integer("attempt").notNullable();
    table.text("status").notNullable();
    table.text("agent_id").references("id").inTable("agents");
    table
      .text("thread_id")
      .references("id")
      .inTable("threads")
      .onDelete("SET NULL");
    table.text("last_run_id").references("id").inTable("runs");
    table.integer("auto_retries").notNullable().defaultTo(0);
    table.text("step").notNullable().defaultTo("");
    table.text("verdict");
    table.text("summary");
    table.text("questions_json");
    table.text("input_json");
    table.integer("superseded").notNullable().defaultTo(0);
    table.text("started_at");
    table.text("finished_at");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.index(["code_run_id", "stage"], "idx_code_run_stages_run");
  });

  await knex.schema.createTable("code_run_artifacts", (table) => {
    table.text("id").primary();
    table
      .text("code_run_id")
      .notNullable()
      .references("id")
      .inTable("code_runs")
      .onDelete("CASCADE");
    table.text("stage").notNullable();
    table.integer("attempt").notNullable();
    table.text("name").notNullable();
    table.text("content").notNullable();
    table.text("created_at").notNullable();
    table.index(["code_run_id", "created_at"], "idx_code_run_artifacts_run");
  });

  await knex.schema.createTable("code_feedback_items", (table) => {
    table.text("id").primary();
    table
      .text("code_run_id")
      .notNullable()
      .references("id")
      .inTable("code_runs")
      .onDelete("CASCADE");
    table.text("github_id").notNullable();
    table.text("kind").notNullable();
    table.text("author").notNullable();
    table.integer("author_is_bot").notNullable().defaultTo(0);
    table.text("path");
    table.integer("line");
    table.text("body").notNullable();
    table.text("url");
    table.integer("review_comment_id");
    table.text("github_updated_at").notNullable();
    table.text("status").notNullable();
    table.text("action");
    table.text("reason");
    table.text("reply");
    table.text("round_stage_id");
    table.text("decided_at");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["code_run_id", "github_id"]);
  });

  await knex.schema.alterTable("runs", (table) => {
    table.text("code_run_stage_id");
    table.index(["code_run_stage_id"], "runs_code_run_stage_id_index");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("runs", (table) => {
    table.dropIndex(["code_run_stage_id"], "runs_code_run_stage_id_index");
    table.dropColumn("code_run_stage_id");
  });
  await knex.schema.dropTable("code_feedback_items");
  await knex.schema.dropTable("code_run_artifacts");
  await knex.schema.dropTable("code_run_stages");
  await knex.schema.dropTable("code_runs");
  await knex.schema.dropTable("code_repositories");
};
