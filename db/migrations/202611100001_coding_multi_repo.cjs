// Coding runs can change several repositories. Per-repository state (workspace,
// commits, pull request, CI) moves from code_runs to code_run_repositories. The
// old code_runs columns stay for compatibility and are no longer written.
exports.up = async function up(knex) {
  await knex.schema.createTable("code_run_repositories", (table) => {
    table.text("id").primary();
    table
      .text("code_run_id")
      .notNullable()
      .references("id")
      .inTable("code_runs")
      .onDelete("CASCADE");
    table
      .text("repository_id")
      .notNullable()
      .references("id")
      .inTable("code_repositories")
      .onDelete("RESTRICT");
    table.integer("position").notNullable();
    table.text("workspace_id").notNullable().unique();
    table.text("workspace_status").notNullable().defaultTo("pending");
    table.text("base_sha");
    table.text("head_sha");
    table.integer("pr_number");
    table.text("pr_url");
    table.text("pr_state");
    table.text("ci_state");
    table.text("pr_checked_at");
    table.text("last_published_sha");
    table.text("published_at");
    table.text("error");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["code_run_id", "repository_id"]);
    table.unique(["code_run_id", "position"]);
    table.index(["repository_id"], "idx_code_run_repositories_repository");
  });

  await knex.schema.alterTable("code_feedback_items", (table) => {
    table.text("run_repository_id");
  });

  const runs = await knex("code_runs").select("*");
  for (const run of runs) {
    const id = `${run.id}:0`;
    await knex("code_run_repositories").insert({
      id,
      code_run_id: run.id,
      repository_id: run.repository_id,
      position: 0,
      workspace_id: run.workspace_id,
      workspace_status: run.workspace_status ?? "pending",
      base_sha: run.base_sha,
      head_sha: run.head_sha,
      pr_number: run.pr_number,
      pr_url: run.pr_url,
      pr_state: run.pr_state,
      ci_state: run.ci_state,
      pr_checked_at: run.pr_checked_at,
      last_published_sha: run.last_published_sha,
      published_at: run.published_at,
      error: null,
      created_at: run.started_at,
      updated_at: run.updated_at,
    });
    await knex("code_feedback_items")
      .where({ code_run_id: run.id })
      .update({ run_repository_id: id });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("code_feedback_items", (table) => {
    table.dropColumn("run_repository_id");
  });
  await knex.schema.dropTable("code_run_repositories");
};
