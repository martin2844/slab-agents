exports.up = async function up(knex) {
  if (
    !(await knex.schema.hasColumn(
      "runtime_configs",
      "openrouter_require_parameters",
    ))
  ) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table
        .boolean("openrouter_require_parameters")
        .notNullable()
        .defaultTo(true);
    });
  }
  if (
    !(await knex.schema.hasColumn(
      "runtime_configs",
      "openrouter_data_collection",
    ))
  ) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.text("openrouter_data_collection").notNullable().defaultTo("deny");
    });
  }
  if (!(await knex.schema.hasColumn("runtime_configs", "openrouter_zdr"))) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.boolean("openrouter_zdr").notNullable().defaultTo(true);
    });
  }

  const now = new Date().toISOString();
  await knex("runtime_configs")
    .insert({
      runtime_id: "openrouter",
      enabled: 0,
      auth_mode: "api_key",
      credential_ciphertext: null,
      base_url: null,
      api_format: null,
      openrouter_require_parameters: 1,
      openrouter_data_collection: "deny",
      openrouter_zdr: 1,
      default_model: "openrouter/auto",
      models_json: JSON.stringify(["openrouter/auto"]),
      config_version: 1,
      last_verification_status: null,
      last_verification_detail: null,
      last_verified_at: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict("runtime_id")
    .ignore();
};

exports.down = async function down(knex) {
  await knex("runtime_configs").where({ runtime_id: "openrouter" }).delete();
  if (await knex.schema.hasColumn("runtime_configs", "openrouter_zdr")) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.dropColumn("openrouter_zdr");
    });
  }
  if (
    await knex.schema.hasColumn("runtime_configs", "openrouter_data_collection")
  ) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.dropColumn("openrouter_data_collection");
    });
  }
  if (
    await knex.schema.hasColumn(
      "runtime_configs",
      "openrouter_require_parameters",
    )
  ) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.dropColumn("openrouter_require_parameters");
    });
  }
};
