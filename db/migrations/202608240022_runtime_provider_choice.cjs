/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("runs", "model"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("model").notNullable().defaultTo("default");
    });
  }
  if (!(await knex.schema.hasColumn("threads", "runtime"))) {
    await knex.schema.alterTable("threads", (table) => {
      table.text("runtime");
    });
    await knex.raw(
      "UPDATE threads SET runtime = 'codex' WHERE runtime_thread_id IS NOT NULL",
    );
  }
  if (!(await knex.schema.hasTable("runtime_configs"))) {
    await knex.schema.createTable("runtime_configs", (table) => {
      table.text("runtime_id").primary();
      table.boolean("enabled").notNullable().defaultTo(false);
      table.text("auth_mode").notNullable();
      table.text("credential_ciphertext");
      table.text("default_model").notNullable().defaultTo("default");
      table.text("models_json").notNullable().defaultTo("[]");
      table.integer("config_version").notNullable().defaultTo(1);
      table.text("last_verification_status");
      table.text("last_verification_detail");
      table.text("last_verified_at");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }
  const timestamp = new Date().toISOString();
  await knex("runtime_configs")
    .insert({
      runtime_id: "codex",
      enabled: true,
      auth_mode: "runtime_owned",
      default_model: "default",
      models_json: JSON.stringify(["default", "gpt-5.4", "gpt-5.5"]),
      config_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict("runtime_id")
    .ignore();
  await knex("runtime_configs")
    .insert({
      runtime_id: "claude",
      enabled: false,
      auth_mode: "api_key",
      default_model: "default",
      models_json: JSON.stringify(["default"]),
      config_version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict("runtime_id")
    .ignore();
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("runtime_configs");
  if (await knex.schema.hasColumn("threads", "runtime")) {
    await knex.schema.alterTable("threads", (table) => {
      table.dropColumn("runtime");
    });
  }
  if (await knex.schema.hasColumn("runs", "model")) {
    await knex.schema.alterTable("runs", (table) => {
      table.dropColumn("model");
    });
  }
};
