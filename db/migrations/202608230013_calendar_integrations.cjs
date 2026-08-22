/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("integration_oauth_states"))) {
    await knex.schema.createTable("integration_oauth_states", (table) => {
      table.text("id").primary();
      table
        .text("integration_id")
        .notNullable()
        .references("id")
        .inTable("integrations")
        .onDelete("CASCADE");
      table.text("provider").notNullable();
      table.text("verifier_ciphertext").notNullable();
      table.text("redirect_uri").notNullable();
      table.integer("integration_version").notNullable().defaultTo(1);
      table.text("expires_at").notNullable();
      table.text("created_at").notNullable();
      table.index("expires_at", "idx_integration_oauth_states_expires");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("integration_oauth_states");
};
