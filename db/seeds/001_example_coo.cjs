/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require("node:crypto");

/**
 * Optional development seed. It is intentionally a no-op unless explicitly
 * enabled, so normal local startup never invents product data.
 * @param {import("knex").Knex} knex
 */
exports.seed = async function seed(knex) {
  if (process.env.SLAB_SEED_EXAMPLE_AGENT !== "true") return;
  const existing = await knex("agents").where({ slug: "coo" }).first();
  if (existing) return;
  const timestamp = new Date().toISOString();
  const agentId = randomUUID();
  await knex("agents").insert({
    id: agentId,
    name: "COO",
    slug: "coo",
    role: "Chief Operating Officer",
    instructions:
      "Keep operating work moving. Use Work for live status and Docs for company context. Surface blockers and propose the next concrete action.",
    runtime: "codex",
    model: "default",
    enabled: 1,
    full_access: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (await knex.schema.hasTable("agent_quick_actions")) {
    await knex("agent_quick_actions").insert([
      {
        id: randomUUID(),
        agent_id: agentId,
        label: "Review work",
        prompt:
          "Review all open and in-progress Work. Flag blocked or stale items and recommend the next action for each priority.",
        position: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: randomUUID(),
        agent_id: agentId,
        label: "Summarize OKRs",
        prompt:
          "Find the current OKRs in Docs, compare them with open Work, and summarize progress, risks, and missing next actions.",
        position: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
  }
};
