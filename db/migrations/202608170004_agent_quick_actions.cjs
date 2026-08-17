/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require("node:crypto");

const COO_ACTIONS = [
  {
    label: "Review work",
    prompt:
      "Review all open and in-progress Work. Flag blocked or stale items and recommend the next action for each priority. If there is no actionable Work yet, use Docs and operating context to create the minimum useful next actions in Slab, then summarize what you created.",
  },
  {
    label: "Summarize OKRs",
    prompt:
      "Find the current OKRs in Docs, compare them with open Work, and summarize progress, risks, and missing next actions. Create concrete Slab work items for material gaps when none exist.",
  },
];

/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("agent_quick_actions"))) {
    await knex.schema.createTable("agent_quick_actions", (table) => {
      table.text("id").primary();
      table
        .text("agent_id")
        .notNullable()
        .references("id")
        .inTable("agents")
        .onDelete("CASCADE");
      table.text("label").notNullable();
      table.text("prompt").notNullable();
      table.integer("position").notNullable().defaultTo(0);
      table.text("created_at").notNullable();
      table.text("updated_at").notNullable();
      table.unique(["agent_id", "label"]);
      table.index(["agent_id", "position"], "idx_agent_quick_actions_agent");
    });
  }

  const coo = await knex("agents").where({ slug: "coo" }).first();
  if (!coo) return;

  const existing = await knex("agent_quick_actions")
    .where({ agent_id: coo.id })
    .first();
  if (existing) return;

  const timestamp = new Date().toISOString();
  await knex("agent_quick_actions").insert(
    COO_ACTIONS.map((action, position) => ({
      id: randomUUID(),
      agent_id: coo.id,
      ...action,
      position,
      created_at: timestamp,
      updated_at: timestamp,
    })),
  );
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("agent_quick_actions");
};
