/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  const columns = [
    ["created_at", (table) => table.text("created_at")],
    ["queued_at", (table) => table.text("queued_at")],
    ["lease_owner", (table) => table.text("lease_owner")],
    ["lease_expires_at", (table) => table.text("lease_expires_at")],
    ["attempt_count", (table) => table.integer("attempt_count").notNullable().defaultTo(0)],
  ];
  for (const [name, add] of columns) {
    if (!(await knex.schema.hasColumn("runs", name))) {
      await knex.schema.alterTable("runs", add);
    }
  }

  await knex.raw(`
    UPDATE runs
    SET created_at = COALESCE(
      created_at,
      (SELECT m.created_at FROM messages m WHERE m.run_id = runs.id ORDER BY m.rowid LIMIT 1),
      started_at,
      completed_at,
      CURRENT_TIMESTAMP
    )
  `);
  await knex.raw(`
    UPDATE runs
    SET queued_at = COALESCE(queued_at, created_at)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_runs_agent_dispatch
    ON runs(agent_id, status, queued_at, created_at)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_runs_lease_expiry
    ON runs(lease_expires_at)
  `);

  if (!(await knex.schema.hasColumn("automations", "last_scheduled_for"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("last_scheduled_for");
    });
  }
  if (!(await knex.schema.hasColumn("automations", "missed_run_policy"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("missed_run_policy").notNullable().defaultTo("latest_once");
    });
  }

  if (!(await knex.schema.hasTable("automation_occurrences"))) {
    await knex.schema.createTable("automation_occurrences", (table) => {
      table.text("automation_id").notNullable();
      table.text("scheduled_for").notNullable();
      table.text("run_id").notNullable().unique();
      table.text("status").notNullable().defaultTo("pending");
      table.text("created_at").notNullable();
      table.text("dispatched_at");
      table.primary(["automation_id", "scheduled_for"]);
      table
        .foreign("automation_id")
        .references("automations.id")
        .onDelete("CASCADE");
    });
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_automation_occurrences_pending
      ON automation_occurrences(status, created_at)
    `);
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("automation_occurrences");
  await knex.raw("DROP INDEX IF EXISTS idx_runs_lease_expiry");
  await knex.raw("DROP INDEX IF EXISTS idx_runs_agent_dispatch");
  for (const column of ["missed_run_policy", "last_scheduled_for"]) {
    if (await knex.schema.hasColumn("automations", column)) {
      await knex.schema.alterTable("automations", (table) => {
        table.dropColumn(column);
      });
    }
  }
  for (const column of [
    "attempt_count",
    "lease_expires_at",
    "lease_owner",
    "queued_at",
    "created_at",
  ]) {
    if (await knex.schema.hasColumn("runs", column)) {
      await knex.schema.alterTable("runs", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
