/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable("github_source_apps", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("organization");
    table.text("app_id");
    table.text("app_slug");
    table.text("private_key_ciphertext");
    table.text("installation_id");
    table.text("account_login");
    table.text("status").notNullable().defaultTo("pending_registration");
    table.text("last_verified_at");
    table.text("last_error");
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique("app_id", { indexName: "uq_github_source_apps_app_id" });
  });

  await knex.schema.createTable("github_source_app_states", (table) => {
    table.text("state_hash").primary();
    table
      .text("github_app_id")
      .notNullable()
      .references("id")
      .inTable("github_source_apps")
      .onDelete("CASCADE");
    table.text("action").notNullable();
    table.text("expires_at").notNullable();
    table.text("created_at").notNullable();
    table.index("expires_at", "idx_github_source_app_states_expires");
  });

  await knex.schema.createTable("knowledge_sources", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("slug").notNullable().unique();
    table.text("kind").notNullable();
    table.text("config_json").notNullable().defaultTo("{}");
    table.text("credentials_ciphertext").notNullable();
    table
      .text("github_app_id")
      .references("id")
      .inTable("github_source_apps")
      .onDelete("RESTRICT");
    table.boolean("enabled").notNullable().defaultTo(true);
    table.integer("version").notNullable().defaultTo(1);
    table.integer("sync_interval_minutes");
    table.text("status").notNullable().defaultTo("never_synced");
    table.text("last_sync_started_at");
    table.text("sync_id");
    table.text("sync_heartbeat_at");
    table.text("last_synced_at");
    table.text("last_error");
    table.text("root_document_id");
    table.integer("item_count").notNullable().defaultTo(0);
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.index(
      ["enabled", "sync_interval_minutes", "last_synced_at"],
      "idx_knowledge_sources_due",
    );
    table.index("github_app_id", "idx_knowledge_sources_github_app");
  });

  await knex.schema.createTable("knowledge_source_items", (table) => {
    table.text("id").primary();
    table
      .text("source_id")
      .notNullable()
      .references("id")
      .inTable("knowledge_sources")
      .onDelete("CASCADE");
    table.text("external_id").notNullable();
    table.text("document_id").notNullable();
    table.text("canonical_url");
    table.text("content_hash").notNullable();
    table.text("remote_updated_at");
    table.text("last_seen_sync_id").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.unique(["source_id", "external_id"], {
      indexName: "uq_knowledge_source_items_external",
    });
    table.unique("document_id", {
      indexName: "uq_knowledge_source_items_document",
    });
    table.index(
      ["source_id", "last_seen_sync_id"],
      "idx_knowledge_source_items_seen",
    );
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("knowledge_source_items");
  await knex.schema.dropTableIfExists("knowledge_sources");
  await knex.schema.dropTableIfExists("github_source_app_states");
  await knex.schema.dropTableIfExists("github_source_apps");
};
