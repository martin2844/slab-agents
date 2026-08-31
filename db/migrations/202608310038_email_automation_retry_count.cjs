/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (
    !(await knex.schema.hasColumn(
      "email_automation_occurrences",
      "error_attempt_count",
    ))
  ) {
    await knex.schema.alterTable("email_automation_occurrences", (table) => {
      table.integer("error_attempt_count").notNullable().defaultTo(0);
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (
    await knex.schema.hasColumn(
      "email_automation_occurrences",
      "error_attempt_count",
    )
  ) {
    await knex.schema.alterTable("email_automation_occurrences", (table) => {
      table.dropColumn("error_attempt_count");
    });
  }
};
