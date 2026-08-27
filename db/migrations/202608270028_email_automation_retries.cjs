/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  const columns = [
    [
      "attempt_count",
      (table) => table.integer("attempt_count").notNullable().defaultTo(0),
    ],
    ["last_error", (table) => table.text("last_error")],
    ["next_attempt_at", (table) => table.text("next_attempt_at")],
  ];
  for (const [name, add] of columns) {
    if (!(await knex.schema.hasColumn("email_automation_occurrences", name))) {
      await knex.schema.alterTable("email_automation_occurrences", add);
    }
  }
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_automation_occurrences_ready
    ON email_automation_occurrences(status, next_attempt_at, created_at)
  `);
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_email_automation_occurrences_ready");
  for (const column of ["next_attempt_at", "last_error", "attempt_count"]) {
    if (await knex.schema.hasColumn("email_automation_occurrences", column)) {
      await knex.schema.alterTable("email_automation_occurrences", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
