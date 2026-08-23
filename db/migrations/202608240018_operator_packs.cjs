/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("operator_pack_definitions"))) {
    await knex.schema.createTable("operator_pack_definitions", (table) => {
      table.text("id").primary();
      table.text("version").notNullable();
      table.text("manifest_json").notNullable();
      table.text("source").notNullable().defaultTo("local");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
    });
  }

  if (!(await knex.schema.hasTable("operator_pack_installations"))) {
    await knex.schema.createTable("operator_pack_installations", (table) => {
      table.text("pack_id").primary();
      table.text("pack_version").notNullable();
      table.text("source").notNullable();
      table.text("status").notNullable();
      table.text("manifest_json").notNullable();
      table.text("last_error");
      table.text("installed_at").notNullable();
      table.text("disabled_at");
      table.text("updated_at").notNullable();
      table.index(["status", "updated_at"], "idx_pack_installations_status");
    });
  }

  if (!(await knex.schema.hasTable("operator_pack_resources"))) {
    await knex.schema.createTable("operator_pack_resources", (table) => {
      table.text("id").primary();
      table
        .text("pack_id")
        .notNullable()
        .references("pack_id")
        .inTable("operator_pack_installations")
        .onDelete("CASCADE");
      table.text("resource_type").notNullable();
      table.text("resource_key").notNullable();
      table.text("resource_id");
      table.boolean("managed").notNullable().defaultTo(true);
      table.boolean("created_by_pack").notNullable().defaultTo(false);
      table.boolean("reattachable").notNullable().defaultTo(false);
      table.text("state").notNullable().defaultTo("applied");
      table.text("baseline_json").notNullable().defaultTo("{}");
      table.text("last_error");
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.unique(["pack_id", "resource_type", "resource_key"], {
        indexName: "uq_pack_resource_key",
      });
      table.index(
        ["resource_type", "resource_id"],
        "idx_pack_resources_identity",
      );
    });
  }

  if (!(await knex.schema.hasTable("operator_pack_acceptance_runs"))) {
    await knex.schema.createTable("operator_pack_acceptance_runs", (table) => {
      table.text("id").primary();
      table
        .text("pack_id")
        .notNullable()
        .references("pack_id")
        .inTable("operator_pack_installations")
        .onDelete("CASCADE");
      table.text("scenario_id").notNullable();
      table.text("pack_version").notNullable();
      table
        .text("run_id")
        .references("id")
        .inTable("runs")
        .onDelete("SET NULL");
      table.text("project_key");
      table.text("issue_key");
      table.text("doc_id");
      table.text("status").notNullable();
      table.text("rubric_json").notNullable();
      table.text("evidence_json").notNullable().defaultTo("{}");
      table.text("error");
      table.text("created_at").notNullable();
      table.text("completed_at");
      table.text("updated_at").notNullable();
      table.unique(["run_id"]);
      table.index(["pack_id", "created_at"], "idx_pack_acceptance_pack");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("operator_pack_acceptance_runs");
  await knex.schema.dropTableIfExists("operator_pack_resources");
  await knex.schema.dropTableIfExists("operator_pack_installations");
  await knex.schema.dropTableIfExists("operator_pack_definitions");
};
