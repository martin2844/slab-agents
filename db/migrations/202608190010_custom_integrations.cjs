/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("integrations"))) {
    return;
  }

  const normalizedSlug = (value) =>
    String(value || "integration")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "integration";

  if (!(await knex.schema.hasColumn("integrations", "slug"))) {
    await knex.schema.alterTable("integrations", (table) => {
      table.text("slug");
    });
  }
  if (!(await knex.schema.hasColumn("integrations", "enabled"))) {
    await knex.schema.alterTable("integrations", (table) => {
      table.integer("enabled").notNullable().defaultTo(1);
    });
  }
  if (!(await knex.schema.hasColumn("integrations", "version"))) {
    await knex.schema.alterTable("integrations", (table) => {
      table.integer("version").notNullable().defaultTo(1);
    });
  }

  // Backfill integration slugs.
  const rows = await knex("integrations").select("id", "name", "provider", "slug");
  for (const row of rows) {
    if (row.slug) continue;
    const base = normalizedSlug(row.name || row.provider || "integration");
    const fallback = `${base}-${String(row.id).slice(0, 8)}`.replace(
      /_+/g,
      "_",
    );
    await knex("integrations").where({ id: row.id }).update({
      slug: fallback,
    });
  }

  // Drop legacy uniqueness on provider so multiple custom integrations can coexist.
  const indexListRaw = await knex.raw("PRAGMA index_list(integrations)");
  const indexRows = Array.isArray(indexListRaw) ? indexListRaw[0] : indexListRaw;
  const indexes = (Array.isArray(indexRows) ? indexRows : []).filter(
    (index) => index && (index.unique === 1 || index[2] === 1),
  );

  for (const index of indexes) {
    const indexName = index.name || index[1];
    if (!indexName || typeof indexName !== "string") continue;
    const indexInfoRaw = await knex.raw(`PRAGMA index_info(${indexName})`);
    const indexColumns = Array.isArray(indexInfoRaw)
      ? indexInfoRaw[0]
      : indexInfoRaw;
    const columns = (Array.isArray(indexColumns) ? indexColumns : []).map(
      (row) => String(row.name || "").toLowerCase(),
    );
    if (columns.includes("provider") && columns.length === 1) {
      await knex.raw("DROP INDEX ??", [indexName]).catch(() => {});
    }
  }

  const existingIndexes = Array.isArray(indexRows) ? indexRows : [];
  const hasIndex = (name) =>
    existingIndexes.some(
      (index) => String(index.name || "").toLowerCase() === String(name).toLowerCase(),
    );

  if (!hasIndex("idx_integrations_slug")) {
    await knex.schema.alterTable("integrations", (table) => {
      table.unique("slug");
    });
  }

  if (!hasIndex("idx_integrations_provider")) {
    await knex.schema.alterTable("integrations", (table) => {
      table.index("provider", "idx_integrations_provider");
    });
  }

  if (!(await knex.schema.hasTable("custom_http_operations"))) {
    await knex.schema.createTable("custom_http_operations", (table) => {
      table.text("id").primary();
      table
        .text("integration_id")
        .notNullable()
        .references("id")
        .inTable("integrations")
        .onDelete("CASCADE");
      table.text("key").notNullable();
      table.text("name").notNullable();
      table.text("description").notNullable().defaultTo("");
      table.text("method").notNullable().defaultTo("GET");
      table.text("path").notNullable();
      table.text("parameters_json").notNullable().defaultTo("[]");
      table.text("response_path");
      table.integer("max_response_bytes");
      table.integer("max_items");
      table.integer("enabled").notNullable().defaultTo(1);
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.unique(["integration_id", "key"]);
    });
  }

  if (!(await knex.schema.hasTable("custom_mcp_tools"))) {
    await knex.schema.createTable("custom_mcp_tools", (table) => {
      table.text("id").primary();
      table
        .text("integration_id")
        .notNullable()
        .references("id")
        .inTable("integrations")
        .onDelete("CASCADE");
      table.text("name").notNullable();
      table.text("description");
      table.text("input_schema_json").notNullable().defaultTo("{}");
      table.integer("read_only_hint").notNullable().defaultTo(1);
      table.integer("destructive_hint").notNullable().defaultTo(0);
      table.integer("idempotent_hint");
      table.integer("open_world_hint");
      table.integer("enabled").notNullable().defaultTo(1);
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.unique(["integration_id", "name"]);
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("custom_mcp_tools");
  await knex.schema.dropTableIfExists("custom_http_operations");

  if (!(await knex.schema.hasTable("integrations"))) {
    return;
  }

  await knex.schema.alterTable("integrations", (table) => {
    table.dropColumn("slug");
    table.dropColumn("enabled");
    table.dropColumn("version");
  });
  await knex.raw("DROP INDEX IF EXISTS idx_integrations_slug");
};
