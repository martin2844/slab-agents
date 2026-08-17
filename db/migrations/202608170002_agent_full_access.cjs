/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("agents", "full_access"))) {
    await knex.schema.alterTable("agents", (table) => {
      table.boolean("full_access").notNullable().defaultTo(false);
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("agents", "full_access")) {
    await knex.schema.alterTable("agents", (table) => {
      table.dropColumn("full_access");
    });
  }
};
