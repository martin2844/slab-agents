/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable("knowledge_sources", (table) => {
    table.integer("access_version").notNullable().defaultTo(1);
  });

  await knex.schema.createTable("agent_knowledge_source_access", (table) => {
    table
      .text("source_id")
      .notNullable()
      .references("id")
      .inTable("knowledge_sources")
      .onDelete("CASCADE");
    table
      .text("agent_id")
      .notNullable()
      .references("id")
      .inTable("agents")
      .onDelete("CASCADE");
    table.text("created_at").notNullable();
    table.primary(["source_id", "agent_id"]);
    table.index("agent_id", "idx_agent_knowledge_source_access_agent");
  });

  // Existing deployments had workspace-wide access. Preserve that behavior
  // once, while new sources remain private until explicitly assigned.
  await knex.raw(`
    INSERT INTO agent_knowledge_source_access(source_id, agent_id, created_at)
    SELECT knowledge_sources.id, agents.id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM knowledge_sources CROSS JOIN agents
  `);
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("agent_knowledge_source_access");
  await knex.schema.alterTable("knowledge_sources", (table) => {
    table.dropColumn("access_version");
  });
};
