exports.up = async function up(knex) {
  await knex.schema.createTable("run_docs_access", (table) => {
    table.text("run_id").primary().references("runs.id").onDelete("CASCADE");
    table.text("service_url").notNullable();
    table.text("closed_at");
    table.text("created_at").notNullable();
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTable("run_docs_access");
};
