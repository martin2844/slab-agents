/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (
    !(await knex.schema.hasColumn("operator_pack_resources", "reattachable"))
  ) {
    await knex.schema.alterTable("operator_pack_resources", (table) => {
      table.boolean("reattachable").notNullable().defaultTo(false);
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("operator_pack_resources", "reattachable")) {
    await knex.schema.alterTable("operator_pack_resources", (table) => {
      table.dropColumn("reattachable");
    });
  }
};
