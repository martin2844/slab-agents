import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
register("./test-alias-loader.mjs", import.meta.url);

test("executeRun resumes the durable runner cursor and applies terminal replay once", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-run-resume-"));
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
    { db },
    { repository },
    { createRunExecution, executeRun },
    { startRunnerRun },
  ] = await Promise.all([
    import("../lib/db.ts"),
    import("../lib/repository.ts"),
    import("../lib/run-service.ts"),
    import("../lib/runner.ts"),
  ]);
  const agent = repository.createAgent({
    name: "Recovery Agent",
    slug: "recovery-agent",
    role: "Operations",
    instructions: "Resume durable work.",
    model: "gpt-5",
    enabled: true,
    fullAccess: false,
  });
  const thread = repository.createThread(agent.id, "Durable recovery");
  const run = createRunExecution({
    runId: "control-plane-run",
    agentId: agent.id,
    threadId: thread.id,
    trigger: "chat",
    mode: "chat",
    prompt: "Continue the interrupted run.",
  });
  db.prepare(
    "UPDATE runs SET runner_run_id=?,runner_event_id=? WHERE id=?",
  ).run("runner-run", 7, run.id);

  repository.setSetting("runner_url", "http://runner.test");
  const calls = [];
  const replay = [
    {
      id: 8,
      type: "assistant.completed",
      runId: "runner-run",
      timestamp: new Date().toISOString(),
      data: { message: "Recovered exactly once." },
    },
    {
      id: 9,
      type: "run.completed",
      runId: "runner-run",
      timestamp: new Date().toISOString(),
      data: { runtimeThreadId: "runtime-thread" },
    },
  ];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return Response.json({ runId: "runner-run", status: "running" });
    }
    return new Response(
      replay.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const starts = [];
  const startRunner = async (input) => {
    starts.push(input);
    return startRunnerRun(input, {
      fetcher,
      retryDelay: async () => {},
    });
  };

  const browserEvents = [];
  for await (const event of executeRun({ runId: run.id }, { startRunner })) {
    browserEvents.push(event);
  }
  assert.equal(starts.length, 1);
  assert.equal(starts[0].runId, "runner-run");
  assert.equal(starts[0].runnerEventCursor, 7);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/runs\/runner-run\/attach$/);
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[1].url, /\/runs\/runner-run\/events$/);
  assert.equal(calls[1].init.headers["Last-Event-ID"], "7");
  assert.ok(
    calls.every(({ url }) => !url.endsWith("/runs")),
    "a durable attach must not create a replacement Runner run",
  );
  assert.equal(repository.getRun(run.id)?.status, "completed");
  assert.equal(repository.getRun(run.id)?.runnerEventId, 9);
  assert.equal(
    repository
      .listRunEvents(run.id)
      .filter(({ type }) => type === "run_completed").length,
    1,
  );
  assert.equal(
    repository
      .listRunEvents(run.id)
      .filter(({ type }) => type === "assistant_message").length,
    1,
  );
  assert.equal(
    repository
      .listMessages(thread.id)
      .filter(({ role }) => role === "assistant").length,
    1,
  );
  assert.equal(
    browserEvents.filter(({ type }) => type === "run_completed").length,
    1,
  );

  for await (const event of executeRun({ runId: run.id }, { startRunner })) {
    // A terminal durable run must not be dispatched again.
    void event;
  }
  assert.equal(starts.length, 1);
  assert.equal(calls.length, 2);
});
