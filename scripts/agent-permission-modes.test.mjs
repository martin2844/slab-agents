import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

test("agent permission modes produce guarded, full, and yolo run policies", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-permission-mode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  await migrations.migrate.latest();
  await migrations.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;

  const [{ agentRepository }, { runRepository }, policy, catalogModule] =
    await Promise.all([
      import("../lib/repositories/agent-repository.ts"),
      import("../lib/repositories/run-repository.ts"),
      import("../lib/agent-tool-policy.ts"),
      import("../lib/agent-tool-catalog.ts"),
    ]);

  const createAgent = (slug, permissionMode) =>
    agentRepository.createAgent({
      name: slug,
      slug,
      role: "Operator",
      instructions: "Operate the assigned workspace capabilities safely.",
      runtime: "codex",
      model: "default",
      enabled: true,
      permissionMode,
      fullAccess: permissionMode === "full" || permissionMode === "yolo",
    });
  const guarded = createAgent("guarded-mode", "guarded");
  const full = createAgent("full-mode", "full");
  const yolo = createAgent("yolo-mode", "yolo");

  assert.equal(guarded.permissionMode, "guarded");
  assert.equal(full.permissionMode, "full");
  assert.equal(yolo.permissionMode, "yolo");

  const emailAccess = {
    agentId: full.id,
    profileId: "profile",
    profileName: "Mailbox",
    accountIds: ["account"],
    readEnabled: true,
    draftEnabled: true,
    sendEnabled: true,
    sendPolicy: "approval_required",
    tokenId: "token",
    tokenPrefix: "prefix",
    tokenCreatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const servers = [
    { name: "work", url: "https://work.example.test/mcp" },
    {
      name: "email",
      url: "https://email.example.test/mcp",
      approval: {
        defaultMode: "approve",
        tools: { email_send: "prompt", email_reply: "prompt" },
      },
    },
  ];
  const snapshot = (agent, access) => {
    const run = runRepository.createRun({
      agentId: agent.id,
      trigger: "manual",
      mode: "task",
      runInstructions: "Exercise permission mode.",
    });
    const catalog = catalogModule.buildAgentToolCatalog({
      agent,
      integrations: [],
      emailAccess: access,
    });
    return policy.snapshotAgentToolPolicies({
      runId: run.id,
      agent,
      servers,
      catalog,
    }).snapshot.policies;
  };

  const guardedPolicies = snapshot(guarded, { ...emailAccess, agentId: guarded.id });
  assert.equal(guardedPolicies.work.tools.get_issue, "approve");
  assert.equal(guardedPolicies.work.defaultMode, "prompt");

  const fullPolicies = snapshot(full, emailAccess);
  assert.equal(fullPolicies.work.defaultMode, "approve");
  assert.equal(fullPolicies.work.tools.delete_issue, "prompt");
  assert.equal(fullPolicies.email.tools.email_send, "prompt");
  assert.equal(fullPolicies.email.tools.email_reply, "prompt");

  const yoloPolicies = snapshot(yolo, { ...emailAccess, agentId: yolo.id });
  assert.deepEqual(yoloPolicies.work, { defaultMode: "approve", tools: {} });
  assert.deepEqual(yoloPolicies.email, { defaultMode: "approve", tools: {} });
});
