import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceRunnerEventCursor,
  restoreRunProgress,
} from "../lib/run-recovery-state.ts";
import {
  attachRunnerTransport,
  createRunnerTransport,
  RunnerStreamInterruptedError,
} from "../lib/runner-transport.ts";

test("run recovery restores durable assistant and usage progress", () => {
  const progress = restoreRunProgress([
    { type: "usage_updated", payload: { callIndex: 3 } },
    { type: "assistant_message", payload: { body: "discarded attempt" } },
    { type: "runtime_thread_recreated", payload: {} },
    { type: "usage_updated", payload: { callIndex: 4 } },
    { type: "assistant_message", payload: { body: "durable answer" } },
  ]);
  assert.deepEqual(progress, {
    assistantBody: "durable answer",
    modelCallIndex: 4,
  });
});

test("runner recovery rejects a gap in retained events", () => {
  assert.equal(advanceRunnerEventCursor(7, 7), null);
  assert.equal(advanceRunnerEventCursor(7, 8), 8);
  assert.throws(
    () => advanceRunnerEventCursor(7, 10),
    /expected 8, received 10/,
  );
});

test("runner transport attaches without creation and resumes SSE from the durable cursor", async () => {
  const calls = [];
  const event = {
    id: 8,
    type: "run.completed",
    runId: "runner-run-1",
    timestamp: "2026-08-23T12:00:00.000Z",
    data: {},
  };
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return Response.json({ runId: "runner-run-1", status: "running" });
    }
    return new Response(`data: ${JSON.stringify(event)}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const transport = await attachRunnerTransport({
    baseUrl: "http://runner.test",
    runId: "runner-run-1",
    headers: { Authorization: "Bearer test" },
    afterEventId: 7,
    fetcher,
    errorFromResponse: async (response) =>
      new Error(`runner status ${response.status}`),
    retryDelay: async () => {},
  });

  assert.ok(transport);
  assert.equal(transport.resumed, true);
  const events = [];
  for await (const current of transport.events) events.push(current);
  assert.deepEqual(events, [event]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /\/runs\/runner-run-1\/attach$/);
  assert.equal(calls[1].init.headers["Last-Event-ID"], "7");
});

test("runner stream interruption remains recoverable instead of looking terminal", async () => {
  let calls = 0;
  const transport = await attachRunnerTransport({
    baseUrl: "http://runner.test",
    runId: "runner-run-1",
    headers: {},
    afterEventId: 0,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({ runId: "runner-run-1", status: "running" });
      }
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    },
    errorFromResponse: async (response) =>
      new Error(`runner status ${response.status}`),
    retryDelay: async () => {},
  });
  assert.ok(transport);
  await assert.rejects(async () => {
    for await (const event of transport.events) void event;
  }, RunnerStreamInterruptedError);
  assert.equal(calls, 5);
});

test("runner transport fails immediately when retained history has a gap", async () => {
  let calls = 0;
  const transport = await attachRunnerTransport({
    baseUrl: "http://runner.test",
    runId: "runner-run-1",
    headers: {},
    afterEventId: 7,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({ runId: "runner-run-1", status: "running" });
      }
      return new Response(
        `data: ${JSON.stringify({
          id: 9,
          type: "run.completed",
          runId: "runner-run-1",
          timestamp: "2026-08-23T12:00:00.000Z",
          data: {},
        })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    },
    errorFromResponse: async (response) =>
      new Error(`runner status ${response.status}`),
    retryDelay: async () => {},
  });
  assert.ok(transport);
  await assert.rejects(async () => {
    for await (const event of transport.events) void event;
  }, /expected 8, received 9/);
  assert.equal(calls, 2);
});

test("temporary runner responses remain recoverable because execution may still be active", async () => {
  const input = {
    baseUrl: "http://runner.test",
    runId: "runner-run-1",
    headers: {},
    fetcher: async () => new Response("unavailable", { status: 503 }),
    errorFromResponse: async (response) =>
      new Error(`runner status ${response.status}`),
    retryDelay: async () => {},
  };
  await assert.rejects(
    () => attachRunnerTransport(input),
    RunnerStreamInterruptedError,
  );
  await assert.rejects(
    () => createRunnerTransport({ ...input, body: "{}" }),
    RunnerStreamInterruptedError,
  );
  await assert.rejects(
    () =>
      createRunnerTransport({
        ...input,
        body: "{}",
        fetcher: async () => new Response("not-json", { status: 202 }),
      }),
    RunnerStreamInterruptedError,
  );
});
