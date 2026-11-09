import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";
register("./test-alias-loader.mjs", import.meta.url);
test("run changes require a stopped run, close its Docs token before undo and preserve the original connection", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "docs-run-changes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "db");
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve("db/migrations"),
      loadExtensions: [".cjs"],
    },
  });
  await knex.migrate.latest();
  await knex.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;
  const [
    { agentRepository },
    { conversationRepository },
    { runRepository },
    { settingsRepository },
    changes,
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/repositories/settings-repository.ts"),
    import("../lib/docs-run-changes.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Docs agent",
    slug: "docs-agent",
    role: "Editor",
    instructions: "Review docs",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(agent.id, "Review");
  const run = runRepository.createRun({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "chat",
    runInstructions: "Review docs",
  });
  settingsRepository.set("docs_mcp_url", "http://docs.test/mcp");
  settingsRepository.set("docs_api_key", "private-docs-admin");
  changes.registerDocsRunAccess(run.id, "http://docs.test/mcp");
  const calls = [];
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let closed = false;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).pathname;
    calls.push(route);
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer private-docs-admin",
    );
    assert.equal(init.redirect, "manual");
    if (route.endsWith("/close")) {
      closed = true;
      return Response.json({ data: { closed: true } });
    }
    if (route.endsWith("/undo")) {
      assert.equal(closed, true);
      return Response.json({
        data: { recorded: true, closed: true, changes: [] },
      });
    }
    return Response.json({ data: { recorded: true, closed, changes: [] } });
  };
  await assert.rejects(changes.undoRunDocsChanges(run.id), /Wait for the run/);
  assert.deepEqual(calls, []);
  runRepository.updateRun(run.id, "failed");
  await changes.undoRunDocsChanges(run.id);
  assert.deepEqual(calls, [
    `/api/run-changes/${run.id}/close`,
    `/api/run-changes/${run.id}/undo`,
  ]);
  assert.equal(
    runRepository.listRunEvents(run.id).at(-1).type,
    "docs_changes_undone",
  );
  await assert.rejects(
    async () => changes.registerDocsRunAccess(run.id, "http://docs.test/mcp"),
    /reopened/,
  );
  settingsRepository.set("docs_mcp_url", "http://other.test/mcp");
  await assert.rejects(
    changes.getRunDocsChanges(run.id),
    /connection has changed/,
  );
  assert.equal(calls.length, 2);
});
