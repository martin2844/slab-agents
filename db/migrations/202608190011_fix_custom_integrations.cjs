/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("integrations"))) return;

  const rawIndexes = await knex.raw("PRAGMA index_list(integrations)");
  const indexes =
    Array.isArray(rawIndexes) &&
    rawIndexes.length === 1 &&
    Array.isArray(rawIndexes[0])
      ? rawIndexes[0]
      : Array.isArray(rawIndexes)
        ? rawIndexes
        : [];

  for (const index of indexes) {
    if (!index || Number(index.unique) !== 1) continue;
    const indexName = String(index.name || "");
    if (!indexName || indexName.startsWith("sqlite_autoindex_")) continue;
    const rawColumns = await knex.raw(
      `PRAGMA index_info(${JSON.stringify(indexName)})`,
    );
    const columns = (
      Array.isArray(rawColumns) &&
      rawColumns.length === 1 &&
      Array.isArray(rawColumns[0])
        ? rawColumns[0]
        : Array.isArray(rawColumns)
          ? rawColumns
          : []
    ).map((row) => String(row.name || "").toLowerCase());
    if (columns.length === 1 && columns[0] === "provider") {
      const escaped = indexName.replace(/"/g, '""');
      await knex.raw(`DROP INDEX IF EXISTS "${escaped}"`);
    }
  }

  if (
    (await knex.schema.hasTable("custom_http_operations")) &&
    !(await knex.schema.hasColumn("custom_http_operations", "timeout_ms"))
  ) {
    await knex.schema.alterTable("custom_http_operations", (table) => {
      table.integer("timeout_ms");
    });
  }

  if (!(await knex.schema.hasTable("run_integration_capabilities"))) {
    await knex.schema.createTable("run_integration_capabilities", (table) => {
      table
        .text("run_id")
        .notNullable()
        .references("id")
        .inTable("runs")
        .onDelete("CASCADE");
      table
        .text("integration_id")
        .notNullable()
        .references("id")
        .inTable("integrations")
        .onDelete("CASCADE");
      table
        .text("agent_id")
        .notNullable()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table.integer("integration_version").notNullable();
      table.text("token_hash").notNullable();
      table.text("allowed_tools_json").notNullable().defaultTo("[]");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.primary(["run_id", "integration_id"]);
      table.index(["run_id", "agent_id"], "idx_run_integration_capabilities");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("run_integration_capabilities");
  if (await knex.schema.hasTable("integrations")) {
    const duplicates = await knex("integrations")
      .select("provider")
      .count({ count: "*" })
      .groupBy("provider")
      .havingRaw("COUNT(*) > 1");
    if (duplicates.length) {
      throw new Error(
        "Cannot restore provider uniqueness while multiple integrations share a provider.",
      );
    }
    await knex.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_unique ON integrations(provider)",
    );
  }

  if (
    (await knex.schema.hasTable("custom_http_operations")) &&
    (await knex.schema.hasColumn("custom_http_operations", "timeout_ms"))
  ) {
    await knex.schema.alterTable("custom_http_operations", (table) => {
      table.dropColumn("timeout_ms");
    });
  }
};
