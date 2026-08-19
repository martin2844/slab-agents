/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("email_integrations"))) {
    await knex.schema.createTable("email_integrations", (table) => {
      table.text("id").primary();
      table.text("service_url").notNullable();
      table.text("status").notNullable().defaultTo("not_tested");
      table.text("last_tested_at");
      table.text("last_error");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("agent_email_access"))) {
    await knex.schema.createTable("agent_email_access", (table) => {
      table
        .text("agent_id")
        .primary()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table.text("profile_id").notNullable();
      table.text("profile_name").notNullable();
      table.integer("read_enabled").notNullable().defaultTo(1);
      table.integer("draft_enabled").notNullable().defaultTo(0);
      table.integer("send_enabled").notNullable().defaultTo(0);
      table.text("send_policy").notNullable().defaultTo("approval_required");
      table.text("token_id").notNullable();
      table.text("token_prefix").notNullable();
      table.text("token_created_at").notNullable();
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("agent_email_accounts"))) {
    await knex.schema.createTable("agent_email_accounts", (table) => {
      table
        .text("agent_id")
        .notNullable()
        .references("agent_id")
        .inTable("agent_email_access")
        .onDelete("CASCADE");
      table.text("account_id").notNullable();
      table.primary(["agent_id", "account_id"]);
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("agent_email_accounts");
  await knex.schema.dropTableIfExists("agent_email_access");
  await knex.schema.dropTableIfExists("email_integrations");
};
