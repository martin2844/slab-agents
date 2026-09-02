/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("agents", "reasoning_effort"))) {
    await knex.schema.alterTable("agents", (table) => {
      table.text("reasoning_effort").notNullable().defaultTo("default");
    });
  }

  if (!(await knex.schema.hasColumn("runs", "reasoning_effort"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("reasoning_effort").notNullable().defaultTo("default");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("runs", "reasoning_effort")) {
    await knex.schema.alterTable("runs", (table) => {
      table.dropColumn("reasoning_effort");
    });
  }
  if (await knex.schema.hasColumn("agents", "reasoning_effort")) {
    await knex.schema.alterTable("agents", (table) => {
      table.dropColumn("reasoning_effort");
    });
  }
};
