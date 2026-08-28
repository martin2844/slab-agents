import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

test("a fresh run receives only its assigned Docs source snapshot", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-docs-source-run-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve("db/migrations"),
      loadExtensions: [".cjs"],
    },
  });
  await migrations.migrate.latest();
  await migrations.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;

  const [
    { agentRepository },
    { sourceRepository },
    { conversationRepository },
    { runRepository },
    { settingsRepository },
    { encryptLocalSecret },
    { startRunnerRun },
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/source-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/repositories/settings-repository.ts"),
    import("../lib/secrets.ts"),
    import("../lib/runner.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Scoped Sales",
    slug: "scoped-sales",
    role: "Sales",
    instructions: "Use only assigned knowledge and current Work context.",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const source = sourceRepository.createSource({
    name: "Sales handbook",
    slug: "sales-handbook",
    kind: "website",
    config: {
      kind: "website",
      siteUrl: "https://docs.example.test",
      sitemapUrl: null,
      authType: "none",
      username: null,
      includePathPrefixes: [],
      maxDocuments: 20,
    },
    credentialsCiphertext: encryptLocalSecret("{}"),
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: null,
    agentIds: [agent.id],
  });
  sourceRepository.createSource({
    name: "Private finance",
    slug: "private-finance",
    kind: "website",
    config: {
      kind: "website",
      siteUrl: "https://finance.example.test",
      sitemapUrl: null,
      authType: "none",
      username: null,
      includePathPrefixes: [],
      maxDocuments: 20,
    },
    credentialsCiphertext: encryptLocalSecret("{}"),
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: null,
    agentIds: [],
  });
  settingsRepository.set("runner_url", "http://runner.test");
  settingsRepository.set("docs_mcp_url", "http://docs.test/mcp");
  settingsRepository.set("docs_api_key", "docs-admin-secret");

  const thread = conversationRepository.createThread(agent.id, "Scoped run");
  const run = runRepository.createRun({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    runInstructions: "Inspect assigned knowledge.",
  });
  let issuedScope;
  let runnerBody;
  const result = await startRunnerRun(
    {
      runId: run.id,
      controlPlaneRunId: run.id,
      agent,
      thread,
      messages: [],
      prompt: "Read the sales handbook.",
      execution: {
        trigger: "manual",
        mode: "task",
        issueKey: null,
        policy: "Complete the current task.",
      },
    },
    {
      fetcher: async (url, init = {}) => {
        const value = String(url);
        if (value.endsWith("/attach")) {
          return Response.json(
            { error: { message: "not found" } },
            { status: 404 },
          );
        }
        if (value === "http://docs.test/api/access-tokens") {
          assert.equal(
            new Headers(init.headers).get("authorization"),
            "Bearer docs-admin-secret",
          );
          issuedScope = JSON.parse(String(init.body));
          return Response.json({
            data: {
              token: "run-scoped-docs-token",
              expiresAt: "2026-08-29T00:00:00.000Z",
            },
            error: null,
          });
        }
        if (value.endsWith("/runs")) {
          runnerBody = JSON.parse(String(init.body));
          return Response.json({ runId: run.id, status: "running" });
        }
        throw new Error(`Definition probe unavailable: ${value}`);
      },
    },
  );
  await result.contextProfile;

  assert.deepEqual(issuedScope.readCollectionIds, ["workspace", source.id]);
  assert.deepEqual(issuedScope.writeCollectionIds, ["workspace"]);
  assert.equal(
    runnerBody.mcpServers.find(({ name }) => name === "docs").credentials
      .bearerToken,
    "run-scoped-docs-token",
  );
  assert.equal(JSON.stringify(runnerBody).includes("docs-admin-secret"), false);
  assert.deepEqual(result.capabilitySnapshot.docsAccess.sources, [
    {
      collectionId: source.id,
      sourceId: source.id,
      name: source.name,
      accessVersion: source.accessVersion,
    },
  ]);
  assert.equal(
    JSON.stringify(result.capabilitySnapshot).includes("run-scoped-docs-token"),
    false,
  );
});
