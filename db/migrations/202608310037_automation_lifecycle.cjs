/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("automations", "lifecycle_status"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("lifecycle_status").notNullable().defaultTo("enabled");
    });
    await knex("automations")
      .where("enabled", false)
      .update({ lifecycle_status: "paused" });
  }
  if (!(await knex.schema.hasColumn("automations", "schedule_timezone"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("schedule_timezone").notNullable().defaultTo("UTC");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  for (const column of ["schedule_timezone", "lifecycle_status"]) {
    if (await knex.schema.hasColumn("automations", column)) {
      await knex.schema.alterTable("automations", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
