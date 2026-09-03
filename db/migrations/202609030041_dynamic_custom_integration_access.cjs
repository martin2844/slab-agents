function normalizeToolKey(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

async function availableToolKeys(knex, integration) {
  if (integration.provider === "custom_http") {
    const operations = await knex("custom_http_operations")
      .select("key")
      .where({ integration_id: integration.id, enabled: 1 })
      .orderBy("key");
    return operations.map(
      ({ key }) => `${integration.slug}__${normalizeToolKey(key)}`,
    );
  }
  if (integration.provider === "custom_mcp") {
    const tools = await knex("custom_mcp_tools")
      .select("name")
      .where({ integration_id: integration.id })
      .orderBy("name");
    return tools.map(
      ({ name }) => `${integration.slug}__${normalizeToolKey(name)}`,
    );
  }
  return [];
}

/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.transaction(async (transaction) => {
    const integrations = await transaction("integrations")
      .select("id", "provider", "slug")
      .whereIn("provider", ["custom_http", "custom_mcp"]);
    const timestamp = new Date().toISOString();

    for (const integration of integrations) {
      const available = await availableToolKeys(transaction, integration);
      if (available.length === 0) continue;
      const rows = await transaction("agent_integration_tools")
        .select("agent_id", "tool_key")
        .where({ integration_id: integration.id });
      const grantsByAgent = new Map();
      for (const row of rows) {
        const grants = grantsByAgent.get(row.agent_id) ?? new Set();
        grants.add(row.tool_key);
        grantsByAgent.set(row.agent_id, grants);
      }

      for (const [agentId, grants] of grantsByAgent) {
        if (!available.every((toolKey) => grants.has(toolKey))) continue;
        await transaction("agent_integration_tools")
          .where({ integration_id: integration.id, agent_id: agentId })
          .delete();
        await transaction("agent_integration_tools").insert({
          agent_id: agentId,
          integration_id: integration.id,
          tool_key: "*",
          created_at: timestamp,
        });
      }
    }
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.transaction(async (transaction) => {
    const wildcardRows = await transaction("agent_integration_tools as access")
      .join("integrations as integration", "integration.id", "access.integration_id")
      .select(
        "access.agent_id",
        "access.integration_id",
        "integration.provider",
        "integration.slug",
      )
      .where("access.tool_key", "*")
      .whereIn("integration.provider", ["custom_http", "custom_mcp"]);
    const timestamp = new Date().toISOString();

    for (const row of wildcardRows) {
      const available = await availableToolKeys(transaction, {
        id: row.integration_id,
        provider: row.provider,
        slug: row.slug,
      });
      await transaction("agent_integration_tools")
        .where({
          integration_id: row.integration_id,
          agent_id: row.agent_id,
          tool_key: "*",
        })
        .delete();
      if (available.length) {
        await transaction("agent_integration_tools").insert(
          available.map((toolKey) => ({
            agent_id: row.agent_id,
            integration_id: row.integration_id,
            tool_key: toolKey,
            created_at: timestamp,
          })),
        );
      }
    }
  });
};
