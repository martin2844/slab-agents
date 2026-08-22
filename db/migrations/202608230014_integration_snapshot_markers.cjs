/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("run_integration_snapshot_markers"))) {
    await knex.schema.createTable(
      "run_integration_snapshot_markers",
      (table) => {
        table
          .text("run_id")
          .notNullable()
          .references("id")
          .inTable("runs")
          .onDelete("CASCADE");
        table.text("scope").notNullable();
        table.text("captured_at").notNullable();
        table.primary(["run_id", "scope"]);
      },
    );
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("run_integration_snapshot_markers");
};
