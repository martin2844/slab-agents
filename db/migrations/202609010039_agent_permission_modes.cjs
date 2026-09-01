/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("agents", "permission_mode"))) {
    await knex.schema.alterTable("agents", (table) => {
      table.text("permission_mode").notNullable().defaultTo("guarded");
    });
  }

  await knex("agents")
    .where("full_access", true)
    .update({ permission_mode: "full" });

  if (await knex.schema.hasTable("agent_tool_policies")) {
    await knex.raw(`
      UPDATE agents
      SET permission_mode = 'custom', full_access = 0
      WHERE EXISTS (
        SELECT 1 FROM agent_tool_policies
        WHERE agent_tool_policies.agent_id = agents.id
      )
    `);
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("agents", "permission_mode")) {
    await knex.schema.alterTable("agents", (table) => {
      table.dropColumn("permission_mode");
    });
  }
};
