/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("runs", "runner_run_id"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("runner_run_id");
    });
  }
  if (!(await knex.schema.hasColumn("runs", "runner_event_id"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.integer("runner_event_id").notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn("runs", "runner_retry_at"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("runner_retry_at");
    });
  }
  await knex.raw(`
    DELETE FROM approvals
    WHERE rowid NOT IN (
      SELECT rowid FROM (
        SELECT rowid,
          ROW_NUMBER() OVER (
            PARTITION BY run_id, runner_approval_id
            ORDER BY
              CASE status
                WHEN 'approved' THEN 3
                WHEN 'denied' THEN 3
                WHEN 'resolving' THEN 2
                ELSE 1
              END DESC,
              CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END DESC,
              resolved_at DESC,
              rowid DESC
          ) AS precedence
        FROM approvals
      ) ranked
      WHERE precedence = 1
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_runner_identity
    ON approvals(run_id, runner_approval_id)
  `);
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_approvals_runner_identity");
  for (const column of [
    "runner_retry_at",
    "runner_event_id",
    "runner_run_id",
  ]) {
    if (await knex.schema.hasColumn("runs", column)) {
      await knex.schema.alterTable("runs", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
