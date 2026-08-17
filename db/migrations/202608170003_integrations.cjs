/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("integrations"))) {
    await knex.schema.createTable("integrations", (table) => {
      table.text("id").primary();
      table.text("provider").notNullable().unique();
      table.text("name").notNullable();
      table.text("config_json").notNullable().defaultTo("{}");
      table.text("credentials_ciphertext").notNullable();
      table.text("status").notNullable().defaultTo("not_tested");
      table.text("last_tested_at");
      table.text("last_error");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("agent_integration_tools"))) {
    await knex.schema.createTable("agent_integration_tools", (table) => {
      table
        .text("agent_id")
        .notNullable()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table
        .text("integration_id")
        .notNullable()
        .references("id")
        .inTable("integrations")
        .onDelete("CASCADE");
      table.text("tool_key").notNullable();
      table.text("created_at").notNullable();
      table.primary(["agent_id", "integration_id", "tool_key"]);
      table.index(
        ["agent_id", "integration_id"],
        "idx_agent_integration_tools",
      );
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("agent_integration_tools");
  await knex.schema.dropTableIfExists("integrations");
};
