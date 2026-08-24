/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable("run_budget_reservations", (table) => {
    table.index(["created_at"], "run_budget_reservations_created_at_index");
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable("run_budget_reservations", (table) => {
    table.dropIndex(["created_at"], "run_budget_reservations_created_at_index");
  });
};
