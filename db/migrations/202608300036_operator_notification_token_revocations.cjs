/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable("operator_notification_settings", (table) => {
    table.text("token_service_url");
  });
  await knex("operator_notification_settings")
    .whereNotNull("token_id")
    .update({
      token_service_url: knex("email_integrations")
        .select("service_url")
        .where({ id: "email" })
        .limit(1),
    });
  await knex.schema.createTable("operator_notification_token_revocations", (table) => {
    table.text("token_id").primary();
    table.text("profile_id").notNullable();
    table.text("service_url").notNullable();
    table.integer("attempt_count").notNullable().defaultTo(0);
    table.text("next_attempt_at").notNullable();
    table.text("last_error");
    table.text("created_at").notNullable();
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("operator_notification_token_revocations");
  await knex.schema.alterTable("operator_notification_settings", (table) => {
    table.dropColumn("token_service_url");
  });
};
