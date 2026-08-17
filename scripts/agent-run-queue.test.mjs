import assert from "node:assert/strict";
import test from "node:test";

import { AgentRunQueue } from "../lib/agent-run-queue.ts";

test("runs for one agent execute one at a time in FIFO order", async () => {
  const queue = new AgentRunQueue();
  const first = queue.acquire("sales", "run-1");
  const second = queue.acquire("sales", "run-2");
  const third = queue.acquire("sales", "run-3");

  assert.equal(first.queued, false);
  assert.equal(second.queued, true);
  assert.equal(third.queued, true);
  await first.ready;

  let secondReady = false;
  void second.ready.then(() => {
    secondReady = true;
  });
  await Promise.resolve();
  assert.equal(secondReady, false);

  queue.release("sales", "run-1");
  await second.ready;
  assert.equal(secondReady, true);
  assert.equal(queue.activeRun("sales"), "run-2");

  queue.release("sales", "run-2");
  await third.ready;
  assert.equal(queue.activeRun("sales"), "run-3");
});

test("different agents do not block one another", async () => {
  const queue = new AgentRunQueue();
  const sales = queue.acquire("sales", "sales-run");
  const coo = queue.acquire("coo", "coo-run");

  assert.equal(sales.queued, false);
  assert.equal(coo.queued, false);
  await Promise.all([sales.ready, coo.ready]);
});

test("releasing a non-active run does not disturb the queue", async () => {
  const queue = new AgentRunQueue();
  const first = queue.acquire("sales", "run-1");
  const second = queue.acquire("sales", "run-2");
  await first.ready;

  queue.release("sales", "run-2");
  assert.equal(queue.activeRun("sales"), "run-1");

  queue.release("sales", "run-1");
  await second.ready;
  assert.equal(queue.activeRun("sales"), "run-2");
});
