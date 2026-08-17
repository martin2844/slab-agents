/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn("runs", "trigger"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("trigger").notNullable().defaultTo("chat");
    });
  }
  if (!(await knex.schema.hasColumn("runs", "mode"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("mode").notNullable().defaultTo("chat");
    });
  }
  if (!(await knex.schema.hasColumn("runs", "issue_key"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("issue_key");
    });
  }
  if (!(await knex.schema.hasColumn("runs", "run_instructions"))) {
    await knex.schema.alterTable("runs", (table) => {
      table.text("run_instructions").notNullable().defaultTo("");
    });
  }
  if (!(await knex.schema.hasColumn("automations", "mode"))) {
    await knex.schema.alterTable("automations", (table) => {
      table.text("mode").notNullable().defaultTo("review");
    });
  }

  await knex.raw(`
    UPDATE runs
    SET trigger = COALESCE(
      (
        SELECT CASE json_extract(e.payload, '$.source')
          WHEN 'operating_loop' THEN 'manual'
          ELSE json_extract(e.payload, '$.source')
        END
        FROM run_events e
        WHERE e.run_id = runs.id AND e.type = 'run_started'
        ORDER BY e.rowid DESC
        LIMIT 1
      ),
      CASE WHEN automation_id IS NOT NULL THEN 'automation' ELSE 'chat' END
    )
  `);
  await knex.raw(`
    UPDATE runs
    SET mode = CASE trigger
      WHEN 'assignment' THEN 'assignment'
      WHEN 'resumed' THEN 'assignment'
      WHEN 'review_requested' THEN 'work_item'
      WHEN 'blocked' THEN 'work_item'
      WHEN 'mention' THEN 'work_item'
      WHEN 'automation' THEN 'review'
      WHEN 'manual' THEN 'task'
      ELSE 'chat'
    END
  `);
  await knex.raw(`
    UPDATE runs
    SET issue_key = (
      SELECT w.issue_key
      FROM work_coordination_events w
      WHERE w.run_id = runs.id
      ORDER BY w.rowid DESC
      LIMIT 1
    )
    WHERE mode IN ('assignment', 'work_item')
  `);
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn("automations", "mode")) {
    await knex.schema.alterTable("automations", (table) => {
      table.dropColumn("mode");
    });
  }
  for (const column of ["run_instructions", "issue_key", "mode", "trigger"]) {
    if (await knex.schema.hasColumn("runs", column)) {
      await knex.schema.alterTable("runs", (table) => {
        table.dropColumn(column);
      });
    }
  }
};
