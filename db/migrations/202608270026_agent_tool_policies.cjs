/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("agent_tool_policies", (table) => {
    table
      .text("agent_id")
      .notNullable()
      .references("id")
      .inTable("agents")
      .onDelete("CASCADE");
    table.text("server_name").notNullable();
    table.text("default_mode").notNullable();
    table.text("tools_json").notNullable().defaultTo("{}");
    table.integer("version").notNullable().defaultTo(1);
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.primary(["agent_id", "server_name"]);
  });

  await knex.schema.createTable("run_tool_policy_snapshots", (table) => {
    table
      .text("run_id")
      .primary()
      .references("id")
      .inTable("runs")
      .onDelete("CASCADE");
    table
      .text("agent_id")
      .notNullable()
      .references("id")
      .inTable("agents");
    table.text("policies_json").notNullable();
    table.text("captured_at").notNullable();
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("run_tool_policy_snapshots");
  await knex.schema.dropTableIfExists("agent_tool_policies");
};
