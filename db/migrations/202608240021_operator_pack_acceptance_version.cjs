/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (
    !(await knex.schema.hasColumn(
      "operator_pack_acceptance_runs",
      "pack_version",
    ))
  ) {
    await knex.schema.alterTable("operator_pack_acceptance_runs", (table) => {
      table.text("pack_version").notNullable().defaultTo("unknown");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (
    await knex.schema.hasColumn("operator_pack_acceptance_runs", "pack_version")
  ) {
    await knex.schema.alterTable("operator_pack_acceptance_runs", (table) => {
      table.dropColumn("pack_version");
    });
  }
};
