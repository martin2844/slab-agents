import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

test("runs receive bounded recall while only completed chat records operator input", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-run-memory-"));
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

  const [
    { agentRepository },
    { conversationRepository },
    { runRepository },
    { createRunExecution, executeRun },
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/run-service.ts"),
  ]);
  const agent = agentRepository.createAgent({
    name: "Memory Agent",
    slug: "memory-agent",
    role: "Operations",
    instructions: "Use current truth.",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  const thread = conversationRepository.createThread(agent.id, "Memory chat");
  const recalled = [];
  const recorded = [];
  const recordedConfigurations = [];
  const runnerInputs = [];
  const memoryConfiguration = {
    provider: "honcho",
    baseUrl: "https://honcho.example.test",
    apiKey: "secret",
    workspaceId: "snapshot-workspace",
    maxContextTokens: 900,
  };
  const recallMemory = async (input) => {
    recalled.push(input);
    return {
      provider: "honcho",
      status: "recalled",
      context: "Long-term memory (non-authoritative): prefers concise answers",
      characters: 65,
      approxTokens: 17,
      truncated: false,
      durationMs: 4,
    };
  };
  const recordMemory = async (input, configuration) => {
    recorded.push(input);
    recordedConfigurations.push(configuration);
    return {
      provider: "honcho",
      status: "recorded",
      characters: input.userMessage.length,
      durationMs: 3,
    };
  };
  const startRunner = async (input) => {
    runnerInputs.push(input);
    return {
      resumed: false,
      runnerStatus: "running",
      contextProfile: null,
      capabilitySnapshot: null,
      events: (async function* () {
        yield {
          id: 1,
          type: "run.started",
          runId: input.runId,
          timestamp: new Date().toISOString(),
          data: {},
        };
        yield {
          id: 2,
          type: "run.completed",
          runId: input.runId,
          timestamp: new Date().toISOString(),
          data: {},
        };
      })(),
    };
  };

  const chat = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "My inbox means the Clasificar inbox.",
  });
  for await (const event of executeRun(
    { runId: chat.id },
    {
      startRunner,
      loadMemoryConfiguration: () => memoryConfiguration,
      recallMemory,
      recordMemory,
    },
  ))
    void event;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runRepository.getRun(chat.id)?.status, "completed");
  assert.equal(runnerInputs[0].memory.status, "recalled");
  assert.equal(recorded.length, 1);
  assert.equal(recordedConfigurations[0], memoryConfiguration);
  assert.equal(recorded[0].userMessage, "My inbox means the Clasificar inbox.");
  assert.ok(
    runRepository
      .listRunEvents(chat.id)
      .some(({ type }) => type === "memory_recall_completed"),
  );
  assert.ok(
    runRepository
      .listRunEvents(chat.id)
      .some(({ type }) => type === "memory_recorded"),
  );

  const task = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    prompt: "Review the current queue.",
  });
  for await (const event of executeRun(
    { runId: task.id },
    {
      startRunner,
      loadMemoryConfiguration: () => memoryConfiguration,
      recallMemory,
      recordMemory,
    },
  ))
    void event;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recalled.length, 2);
  assert.equal(recorded.length, 1, "non-chat runs must not become memory input");
  assert.equal(runRepository.getRun(task.id)?.status, "completed");
});
