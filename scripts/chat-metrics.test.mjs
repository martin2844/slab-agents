import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplyDurations,
  formatReplyDuration,
} from "../lib/chat-metrics.ts";

test("reply duration uses compact human-readable units", () => {
  assert.equal(formatReplyDuration(450), "<1s");
  assert.equal(formatReplyDuration(12_200), "12s");
  assert.equal(formatReplyDuration(68_000), "1m 8s");
  assert.equal(formatReplyDuration(3_780_000), "1h 3m");
  assert.equal(formatReplyDuration(-1), null);
});

test("reply duration pairs persisted user and assistant messages by run", () => {
  const messages = [
    {
      id: "user-1",
      threadId: "thread-1",
      runId: "run-1",
      role: "user",
      body: "Review open work",
      createdAt: "2026-08-17T09:00:00.000Z",
    },
    {
      id: "assistant-1",
      threadId: "thread-1",
      runId: "run-1",
      role: "assistant",
      body: "Here is the review.",
      createdAt: "2026-08-17T09:01:08.000Z",
    },
    {
      id: "assistant-without-run",
      threadId: "thread-1",
      runId: null,
      role: "assistant",
      body: "Legacy response",
      createdAt: "2026-08-17T09:02:00.000Z",
    },
  ];

  const durations = buildReplyDurations(messages);
  assert.equal(durations.get("assistant-1"), "1m 8s");
  assert.equal(durations.has("assistant-without-run"), false);
});
