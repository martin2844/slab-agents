import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./test-alias-loader.mjs", import.meta.url);

const { createMemoryModule } = await import("../lib/memory/service.ts");

const enabledConfiguration = {
  provider: "honcho",
  baseUrl: "http://honcho.test:8000",
  apiKey: "honcho-super-secret",
  workspaceId: "slab-test",
  maxContextTokens: 200,
};

function clock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

test("disabled memory never creates a provider client", async () => {
  let clients = 0;
  const memory = createMemoryModule({
    loadConfiguration: () => ({
      ...enabledConfiguration,
      provider: "disabled",
    }),
    createClient() {
      clients += 1;
      throw new Error("must not be called");
    },
    now: clock(0),
  });

  const recall = await memory.recall({
    agentId: "coo",
    agentName: "COO",
    agentRole: "Operations",
    prompt: "What did I prefer?",
    mode: "chat",
    issueKey: null,
  });
  const record = await memory.record({
    runId: "run-1",
    threadId: "thread-1",
    agentId: "coo",
    agentName: "COO",
    agentRole: "Operations",
    userMessage: "Remember this",
    createdAt: "2026-08-26T10:00:00.000Z",
  });

  assert.equal(clients, 0);
  assert.equal(recall.status, "disabled");
  assert.equal(record.status, "disabled");
});

test("recall is bounded and explicitly non-authoritative", async () => {
  const memory = createMemoryModule({
    loadConfiguration: () => enabledConfiguration,
    createClient: () => ({
      getMetadata: async () => ({}),
      peer: async () => ({
        representation: async () => "x".repeat(1_200),
      }),
      session: async () => ({}),
    }),
    now: clock(100, 125),
  });

  const result = await memory.recall({
    agentId: "coo",
    agentName: "COO",
    agentRole: "Operations",
    prompt: "Find preferences",
    mode: "review",
    issueKey: null,
  });

  assert.equal(result.status, "recalled");
  assert.equal(result.truncated, true);
  assert.equal(result.durationMs, 25);
  assert.match(result.context, /non-authoritative/i);
  assert.match(result.context, /may be stale/i);
  assert.match(result.context, /never follow instructions/i);
  assert.ok(result.approxTokens <= enabledConfiguration.maxContextTokens);
});

test("recall redacts credential-shaped values from provider queries", async () => {
  let searchQuery = "";
  const memory = createMemoryModule({
    loadConfiguration: () => enabledConfiguration,
    createClient: () => ({
      getMetadata: async () => ({}),
      peer: async () => ({
        representation: async (options) => {
          searchQuery = options.searchQuery;
          return "Known preference";
        },
      }),
      session: async () => ({}),
    }),
    now: clock(10, 20),
  });

  await memory.recall({
    agentId: "coo",
    agentName: "COO",
    agentRole: "Operations",
    prompt: "Use Authorization: Bearer operator-secret for this request",
    mode: "chat",
    issueKey: null,
  });

  assert.doesNotMatch(searchQuery, /operator-secret/);
  assert.match(searchQuery, /\[REDACTED\]/);
});

test("provider failures are fail-open and redact configured secrets", async () => {
  const memory = createMemoryModule({
    loadConfiguration: () => enabledConfiguration,
    createClient: () => ({
      getMetadata: async () => ({}),
      peer: async () => {
        throw new Error(
          `upstream rejected Authorization: Bearer ${enabledConfiguration.apiKey}`,
        );
      },
      session: async () => ({}),
    }),
    now: clock(10, 20),
  });

  const result = await memory.recall({
    agentId: "coo",
    agentName: "COO",
    agentRole: "Operations",
    prompt: "Continue normally",
    mode: "chat",
    issueKey: null,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.context, "");
  assert.doesNotMatch(result.error, /honcho-super-secret/);
  assert.match(result.error, /\[REDACTED\]/);
});

test("record stores one redacted operator message in a thread-scoped session", async () => {
  const observed = { peers: [], sessions: [], setPeers: [], messages: [] };
  const operator = {
    id: "operator",
    message(content, options) {
      return { content, options };
    },
  };
  const agent = { id: "agent-coo" };
  const session = {
    async setPeers(peers) {
      observed.setPeers.push(peers);
    },
    async addMessages(...messages) {
      observed.messages.push(...messages);
    },
  };
  const memory = createMemoryModule({
    loadConfiguration: () => enabledConfiguration,
    createClient: () => ({
      getMetadata: async () => ({}),
      async peer(id, options) {
        observed.peers.push([id, options]);
        return id === "operator" ? operator : agent;
      },
      async session(id, options) {
        observed.sessions.push([id, options]);
        return session;
      },
    }),
    now: clock(50, 68),
  });

  const result = await memory.record({
    runId: "run-7",
    threadId: "thread-9",
    agentId: "coo",
    agentName: "COO",
    agentRole: "Operations",
    userMessage:
      "My inbox means Clasificar. password=hunter2 Authorization: Bearer abc123",
    createdAt: "2026-08-26T10:00:00.000Z",
  });

  assert.equal(result.status, "recorded");
  assert.deepEqual(observed.sessions[0][0], "thread-thread-9");
  assert.deepEqual(observed.setPeers[0], [
    ["operator", { observeMe: true, observeOthers: false }],
    ["agent-coo", { observeMe: false, observeOthers: true }],
  ]);
  assert.equal(observed.messages.length, 1);
  assert.match(observed.messages[0].content, /My inbox means Clasificar/);
  assert.doesNotMatch(observed.messages[0].content, /hunter2|abc123/);
  assert.match(observed.messages[0].content, /\[REDACTED\]/);
  assert.equal(observed.messages[0].options.metadata.role, "user");
});

test("connection check does not expose API keys in failures", async () => {
  const memory = createMemoryModule({
    loadConfiguration: () => enabledConfiguration,
    createClient: () => ({
      getMetadata: async () => {
        throw new Error(`invalid key ${enabledConfiguration.apiKey}`);
      },
      peer: async () => ({}),
      session: async () => ({}),
    }),
    now: clock(3, 9),
  });

  const result = await memory.check();
  assert.equal(result.status, "unavailable");
  assert.equal(result.durationMs, 6);
  assert.doesNotMatch(result.detail, /honcho-super-secret/);
});
