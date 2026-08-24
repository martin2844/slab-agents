exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("runtime_configs")
    .insert({
      runtime_id: "gemini",
      enabled: 0,
      auth_mode: "runtime_owned",
      credential_ciphertext: null,
      base_url: null,
      api_format: null,
      default_model: "default",
      models_json: JSON.stringify(["default"]),
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
  await knex("runtime_configs").where({ runtime_id: "gemini" }).delete();
};
