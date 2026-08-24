import assert from "node:assert/strict";
import test from "node:test";
import { buildRunContextProfile } from "../lib/run-context-profile.ts";

const run = {
  id: "run-1",
  agentId: "sales",
  threadId: "thread-1",
  automationId: null,
  status: "completed",
  runtime: "codex",
  startedAt: "2026-08-17T12:00:00.000Z",
  completedAt: "2026-08-17T12:00:10.000Z",
  error: null,
  usage: null,
};

function event(type, payload, second) {
  return {
    id: `${type}-${second}`,
    runId: "run-1",
    type,
    payload,
    createdAt: `2026-08-17T12:00:${String(second).padStart(2, "0")}.000Z`,
  };
}

test("run profile correlates per-call usage with repeated and expensive tools", () => {
  const events = [
    event(
      "run_context_profile",
      {
        estimator: "characters_divided_by_4",
        capturedAt: "2026-08-17T12:00:00.000Z",
        attempt: 1,
        instructionBundle: { bytes: 400, approxTokens: 100 },
        components: [
          {
            key: "agent_instructions",
            label: "Agent instructions",
            bytes: 200,
            approxTokens: 50,
          },
          {
            key: "initial_user_input",
            label: "Initial user / task input",
            bytes: 80,
            approxTokens: 20,
          },
          {
            key: "mcp_server_configuration",
            label: "MCP server configuration",
            bytes: 40,
            approxTokens: 10,
          },
        ],
        mcpServers: [
          {
            server: "docs",
            bytes: 120,
            approxTokens: 30,
            toolCount: 1,
            tools: [{ name: "get_doc", bytes: 120, approxTokens: 30 }],
            success: true,
          },
        ],
      },
      0,
    ),
    event(
      "runtime_context_bootstrap",
      {
        attempt: 1,
        runnerGeneratedInstructionsApprox: { bytes: 40, approxTokens: 10 },
        turnInputTotal: { bytes: 120, approxTokens: 30 },
        initialUserInput: { bytes: 80, approxTokens: 20 },
        rehydratedConversationContextApprox: {
          bytes: 0,
          approxTokens: 0,
        },
      },
      0,
    ),
    event(
      "usage_updated",
      {
        callIndex: 1,
        inputTokens: 1_000,
        cachedInputTokens: 600,
        uncachedInputTokens: 400,
        outputTokens: 50,
        reasoningOutputTokens: 20,
        totalTokens: 1_050,
        modelContextWindow: 128_000,
      },
      1,
    ),
    event(
      "tool_completed",
      {
        toolId: "docs-1",
        server: "docs",
        tool: "get_doc",
        name: "docs.get_doc",
        kind: "mcpToolCall",
        argumentsBytes: 20,
        argumentsApproxTokens: 5,
        responseBytes: 2_000,
        responseApproxTokens: 500,
        success: true,
        searchQuery: "pricing",
        searchResultCount: 1,
        searchResults: [
          {
            id: "doc-1",
            slug: "pricing",
            title: "Pricing",
            score: 2.5,
          },
        ],
      },
      2,
    ),
    event(
      "tool_completed",
      {
        toolId: "docs-2",
        server: "docs",
        tool: "get_doc",
        name: "docs.get_doc",
        kind: "mcpToolCall",
        argumentsBytes: 20,
        argumentsApproxTokens: 5,
        responseBytes: 1_000,
        responseApproxTokens: 250,
        success: true,
      },
      3,
    ),
    event(
      "usage_updated",
      {
        callIndex: 2,
        inputTokens: 1_700,
        cachedInputTokens: 1_300,
        uncachedInputTokens: 400,
        outputTokens: 60,
        reasoningOutputTokens: 25,
        totalTokens: 1_760,
        modelContextWindow: 128_000,
      },
      4,
    ),
  ];

  const profile = buildRunContextProfile(run, events);

  assert.equal(profile.captured, true);
  assert.equal(profile.durationMs, 10_000);
  assert.equal(profile.modelCalls.length, 2);
  assert.equal(profile.modelCallCount, 2);
  assert.equal(profile.cumulativeInputTokens, 2_700);
  assert.equal(profile.cumulativeCachedInputTokens, 1_900);
  assert.equal(profile.contextGrowthTokens, 700);
  assert.equal(profile.toolCalls.length, 2);
  assert.equal(profile.mcpResponseApproxTokens, 750);
  assert.equal(profile.toolBreakdown[0].key, "docs.get_doc");
  assert.equal(profile.toolBreakdown[0].calls, 2);
  assert.equal(profile.repeatedCalls[0].key, "docs.get_doc");
  assert.equal(profile.largestResponses[0].toolId, "docs-1");
  assert.equal(profile.toolCalls[0].searchQuery, "pricing");
  assert.deepEqual(profile.toolCalls[0].searchResults, [
    {
      id: "doc-1",
      slug: "pricing",
      title: "Pricing",
      score: 2.5,
    },
  ]);
  assert.deepEqual(
    profile.timeline.map((entry) => entry.entryType),
    ["model", "tool", "tool", "model"],
  );
});

test("aggregate runtime usage does not invent per-call context metrics", () => {
  const profile = buildRunContextProfile(run, [
    event(
      "usage_updated",
      {
        callIndex: 1,
        usageScope: "run_aggregate",
        providerTurnCount: 2,
        inputTokens: 2_700,
        cachedInputTokens: 1_900,
        uncachedInputTokens: 800,
        outputTokens: 110,
        totalTokens: 2_810,
        modelContextWindow: 200_000,
      },
      5,
    ),
  ]);

  assert.equal(profile.modelCallCount, null);
  assert.equal(profile.providerTurnCount, 2);
  assert.equal(profile.cumulativeInputTokens, 2_700);
  assert.equal(profile.initialModelCallInputTokens, null);
  assert.equal(profile.peakModelCallInputTokens, null);
  assert.equal(profile.contextGrowthTokens, null);
  assert.match(profile.limitations.join(" "), /aggregate Run usage/);
});

test("legacy usage remains analyzable without claiming bootstrap capture", () => {
  const profile = buildRunContextProfile(run, [
    event(
      "usage_updated",
      {
        total: { inputTokens: 200 },
        last: {
          inputTokens: 200,
          cachedInputTokens: 128,
          outputTokens: 12,
          reasoningOutputTokens: 4,
          totalTokens: 212,
        },
        modelContextWindow: 64_000,
      },
      1,
    ),
  ]);

  assert.equal(profile.captured, false);
  assert.equal(profile.initialModelCallInputTokens, 200);
  assert.equal(profile.cumulativeUncachedInputTokens, 72);
  assert.match(profile.limitations[0], /predates/);
});

test("missing tool terminal events remain visible as failed calls", () => {
  const profile = buildRunContextProfile(run, [
    event(
      "tool_started",
      {
        toolId: "work-open",
        server: "work",
        tool: "get_issue",
        name: "work.get_issue",
        kind: "mcpToolCall",
        argumentsApproxTokens: 4,
      },
      1,
    ),
    event(
      "tool_failed",
      {
        toolId: "work-open",
        server: "work",
        tool: "get_issue",
        name: "work.get_issue",
        kind: "mcpToolCall",
        status: "failed",
        success: false,
        reason: "terminal_event_missing",
        argumentsApproxTokens: 4,
        durationMs: 25,
      },
      2,
    ),
  ]);

  assert.equal(profile.toolCalls.length, 1);
  assert.equal(profile.toolCalls[0].success, false);
  assert.equal(profile.toolCalls[0].status, "failed");
  assert.equal(profile.toolCalls[0].reason, "terminal_event_missing");
  assert.equal(profile.toolCalls[0].responseApproxTokens, 0);
  assert.equal(profile.timeline[0].entryType, "tool");
});

test("tools reported before first usage update are grouped after model call one", () => {
  const profile = buildRunContextProfile(run, [
    event(
      "tool_completed",
      {
        toolId: "work-1",
        server: "work",
        tool: "list_projects",
        name: "work.list_projects",
        kind: "mcpToolCall",
        responseBytes: 400,
        responseApproxTokens: 100,
      },
      1,
    ),
    event(
      "usage_updated",
      {
        callIndex: 1,
        inputTokens: 1_000,
        cachedInputTokens: 500,
      },
      2,
    ),
    event(
      "usage_updated",
      {
        callIndex: 2,
        inputTokens: 1_200,
        cachedInputTokens: 600,
      },
      3,
    ),
  ]);

  assert.deepEqual(
    profile.timeline.map((entry) =>
      entry.entryType === "model" ? `model-${entry.callIndex}` : entry.name,
    ),
    ["model-1", "work.list_projects", "model-2"],
  );
});
