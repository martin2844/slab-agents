exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("runtime_configs", "base_url"))) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.text("base_url").nullable();
    });
  }
  if (!(await knex.schema.hasColumn("runtime_configs", "api_format"))) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.text("api_format").nullable();
    });
  }
  const now = new Date().toISOString();
  await knex("runtime_configs")
    .insert({
      runtime_id: "direct_api",
      enabled: 0,
      auth_mode: "api_key",
      credential_ciphertext: null,
      base_url: "https://api.openai.com/v1",
      api_format: "responses",
      default_model: "gpt-5.4",
      models_json: JSON.stringify(["gpt-5.4"]),
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
  await knex("runtime_configs").where({ runtime_id: "direct_api" }).delete();
  if (await knex.schema.hasColumn("runtime_configs", "api_format")) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.dropColumn("api_format");
    });
  }
  if (await knex.schema.hasColumn("runtime_configs", "base_url")) {
    await knex.schema.alterTable("runtime_configs", (table) => {
      table.dropColumn("base_url");
    });
  }
};
