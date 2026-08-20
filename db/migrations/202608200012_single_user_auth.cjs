/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("auth_credentials"))) {
    await knex.schema.createTable("auth_credentials", (table) => {
      table.text("id").primary();
      table.text("password_hash").notNullable();
      table.integer("session_generation").notNullable().defaultTo(1);
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("auth_sessions"))) {
    await knex.schema.createTable("auth_sessions", (table) => {
      table.text("token_hash").primary();
      table.integer("generation").notNullable();
      table.text("created_at").notNullable();
      table.text("last_seen_at").notNullable();
      table.text("expires_at").notNullable();
      table.index(["expires_at"], "idx_auth_sessions_expires");
    });
  }

  if (!(await knex.schema.hasTable("auth_login_attempts"))) {
    await knex.schema.createTable("auth_login_attempts", (table) => {
      table.text("client_key").primary();
      table.integer("attempts").notNullable();
      table.text("window_started_at").notNullable();
      table.text("blocked_until");
      table.text("updated_at").notNullable();
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("auth_login_attempts");
  await knex.schema.dropTableIfExists("auth_sessions");
  await knex.schema.dropTableIfExists("auth_credentials");
};
