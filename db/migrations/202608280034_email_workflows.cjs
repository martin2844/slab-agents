const defaultMatch = JSON.stringify({
  recipientAddress: null,
  senderAddress: null,
  senderDomain: null,
  subjectIncludes: null,
});

/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  const automationColumns = [
    [
      "workflow_version",
      (table) => table.integer("workflow_version").notNullable().defaultTo(1),
    ],
    [
      "email_match_json",
      (table) => table.text("email_match_json").notNullable().defaultTo(defaultMatch),
    ],
    ["workflow_steps_json", (table) => table.text("workflow_steps_json")],
  ];
  for (const [name, add] of automationColumns) {
    if (!(await knex.schema.hasColumn("automations", name))) {
      await knex.schema.alterTable("automations", add);
    }
  }

  const emailAutomations = await knex("automations")
    .select("id", "agent_id", "prompt")
    .where("trigger_type", "email")
    .whereNull("workflow_steps_json");
  for (const automation of emailAutomations) {
    await knex("automations").where("id", automation.id).update({
      email_match_json: defaultMatch,
      workflow_steps_json: JSON.stringify([
        {
          id: `step-${automation.id}`,
          type: "agent_task",
          agentId: automation.agent_id,
          action: "analyze",
          legacyUnrestricted: true,
          prompt: automation.prompt,
        },
      ]),
    });
  }

  if (!(await knex.schema.hasTable("automation_executions"))) {
    await knex.schema.createTable("automation_executions", (table) => {
      table.text("id").primary();
      table.text("automation_id");
      table.text("automation_name").notNullable();
      table.integer("definition_version").notNullable();
      table.text("definition_json").notNullable();
      table.text("event_json").notNullable();
      table.text("conversation_key").notNullable();
      table.text("status").notNullable().defaultTo("pending");
      table.integer("current_step_index").notNullable().defaultTo(0);
      table.text("error");
      table.text("created_at").notNullable();
      table.text("started_at");
      table.text("completed_at");
      table
        .foreign("automation_id")
        .references("automations.id")
        .onDelete("SET NULL");
      table.index(
        ["automation_id", "created_at"],
        "idx_automation_executions_automation",
      );
      table.index(
        ["status", "created_at"],
        "idx_automation_executions_status",
      );
    });
    await knex.raw(`
      CREATE UNIQUE INDEX idx_automation_executions_active_conversation
      ON automation_executions(automation_id, conversation_key)
      WHERE automation_id IS NOT NULL
        AND status IN ('pending','running','waiting_approval')
    `);
  }

  if (!(await knex.schema.hasTable("automation_step_executions"))) {
    await knex.schema.createTable("automation_step_executions", (table) => {
      table.text("execution_id").notNullable();
      table.text("step_id").notNullable();
      table.integer("step_index").notNullable();
      table.text("step_type").notNullable();
      table.text("agent_id").notNullable();
      table.text("agent_name").notNullable();
      table.text("action").notNullable();
      table.text("run_id").unique();
      table.text("status").notNullable().defaultTo("pending");
      table.text("error");
      table.text("created_at").notNullable();
      table.text("started_at");
      table.text("completed_at");
      table.primary(["execution_id", "step_id"]);
      table
        .foreign("execution_id")
        .references("automation_executions.id")
        .onDelete("CASCADE");
      table.index(
        ["execution_id", "step_index"],
        "idx_automation_step_executions_order",
      );
    });
  }

  if (
    !(await knex.schema.hasColumn(
      "email_automation_occurrences",
      "execution_id",
    ))
  ) {
    await knex.schema.alterTable("email_automation_occurrences", (table) => {
      table.text("execution_id").unique();
      table
        .foreign("execution_id")
        .references("automation_executions.id")
        .onDelete("SET NULL");
    });
  }
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (
    await knex.schema.hasColumn(
      "email_automation_occurrences",
      "execution_id",
    )
  ) {
    await knex.schema.alterTable("email_automation_occurrences", (table) => {
      table.dropColumn("execution_id");
    });
  }
  await knex.schema.dropTableIfExists("automation_step_executions");
  await knex.raw(
    "DROP INDEX IF EXISTS idx_automation_executions_active_conversation",
  );
  await knex.schema.dropTableIfExists("automation_executions");
  for (const column of [
    "workflow_steps_json",
    "email_match_json",
    "workflow_version",
  ]) {
    if (await knex.schema.hasColumn("automations", column)) {
      await knex.schema.alterTable("automations", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
