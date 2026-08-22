/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (
    (await knex.schema.hasTable("integration_oauth_states")) &&
    !(await knex.schema.hasColumn(
      "integration_oauth_states",
      "integration_version",
    ))
  ) {
    await knex.schema.alterTable("integration_oauth_states", (table) => {
      table.integer("integration_version").notNullable().defaultTo(1);
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (
    await knex.schema.hasColumn(
      "integration_oauth_states",
      "integration_version",
    )
  ) {
    await knex.schema.alterTable("integration_oauth_states", (table) => {
      table.dropColumn("integration_version");
    });
  }
};
