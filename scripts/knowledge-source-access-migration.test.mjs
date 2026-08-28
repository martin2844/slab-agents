import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");

test("source ACL migration preserves existing workspace-wide access", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-source-acl-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "workspace.db") },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  t.after(() => knex.destroy());

  const filenames = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".cjs"))
    .sort();
  for (const name of filenames) {
    if (name === "202608280033_knowledge_source_access.cjs") break;
    await knex.migrate.up({ name });
  }

  const timestamp = "2026-08-28T00:00:00.000Z";
  await knex("agents").insert([
    {
      id: "agent-a",
      name: "Agent A",
      slug: "agent-a",
      role: "Operator",
      instructions: "Operate safely with assigned knowledge.",
      runtime: "codex",
      model: "default",
      enabled: 1,
      full_access: 0,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "agent-b",
      name: "Agent B",
      slug: "agent-b",
      role: "Operator",
      instructions: "Operate safely with assigned knowledge.",
      runtime: "codex",
      model: "default",
      enabled: 1,
      full_access: 0,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ]);
  await knex("knowledge_sources").insert({
    id: "source-existing",
    name: "Existing source",
    slug: "existing-source",
    kind: "website",
    config_json: JSON.stringify({
      kind: "website",
      siteUrl: "https://docs.example.test",
      sitemapUrl: null,
      authType: "none",
      username: null,
      includePathPrefixes: [],
      maxDocuments: 20,
    }),
    credentials_ciphertext: "encrypted-placeholder",
    enabled: 1,
    version: 1,
    status: "healthy",
    item_count: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });

  await knex.migrate.up({ name: "202608280033_knowledge_source_access.cjs" });
  const rows = await knex("agent_knowledge_source_access")
    .select("source_id", "agent_id")
    .orderBy("agent_id");
  assert.deepEqual(rows, [
    { source_id: "source-existing", agent_id: "agent-a" },
    { source_id: "source-existing", agent_id: "agent-b" },
  ]);
  assert.deepEqual(
    await knex("knowledge_sources")
      .select("access_version")
      .where({ id: "source-existing" })
      .first(),
    { access_version: 1 },
  );
});
