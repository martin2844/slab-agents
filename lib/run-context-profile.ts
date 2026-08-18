import type { Run, RunEvent } from "@/lib/types";

export type SizeMetric = {
  bytes: number;
  approxTokens: number;
};

export type ContextComponent = SizeMetric & {
  key: string;
  label: string;
};

export type McpToolDefinitionMetric = SizeMetric & {
  name: string;
};

export type McpServerDefinitionMetric = SizeMetric & {
  server: string;
  toolCount: number;
  tools: McpToolDefinitionMetric[];
  success: boolean;
  error?: string;
};

export type ControlPlaneContextProfile = {
  estimator: "characters_divided_by_4";
  capturedAt: string;
  instructionBundle: SizeMetric;
  components: ContextComponent[];
  mcpServers: McpServerDefinitionMetric[];
  attempt?: number;
  runnerRunId?: string;
};

export type ModelCallProfile = {
  callIndex: number;
  createdAt: string;
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  modelContextWindow: number | null;
  inputDeltaTokens: number | null;
};

export type ToolCallProfile = {
  toolId: string;
  server: string;
  tool: string;
  name: string;
  kind: string;
  startedAt: string | null;
  completedAt: string;
  durationMs: number | null;
  argumentsBytes: number;
  argumentsApproxTokens: number;
  argumentsPreview: string | null;
  responseBytes: number;
  responseApproxTokens: number;
  responsePreview: string | null;
  success: boolean | null;
  status: string | null;
  reason: string | null;
  command: string | null;
  exitCode: number | null;
  outputBytes: number | null;
  outputApproxTokens: number | null;
  streamBreakdownAvailable: boolean | null;
  debugArgumentsPayload: unknown | null;
  debugResponsePayload: unknown | null;
  searchQuery: string | null;
  searchResultCount: number | null;
  searchResults: Array<{
    id: string | null;
    slug: string | null;
    title: string;
    score: number | null;
  }>;
};

export type ToolBreakdownProfile = {
  key: string;
  server: string;
  tool: string;
  calls: number;
  responseBytes: number;
  responseApproxTokens: number;
  largestResponseApproxTokens: number;
};

export type RunProfileTimelineEntry =
  | ({ entryType: "model" } & ModelCallProfile)
  | ({ entryType: "tool" } & ToolCallProfile);

export type RunContextProfile = {
  captured: boolean;
  durationMs: number | null;
  knownInitialContextApproxTokens: number;
  unattributedInitialContextApproxTokens: number | null;
  contextComponents: ContextComponent[];
  mcpServers: McpServerDefinitionMetric[];
  modelCalls: ModelCallProfile[];
  cumulativeInputTokens: number;
  cumulativeCachedInputTokens: number;
  cumulativeUncachedInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeReasoningOutputTokens: number;
  initialModelCallInputTokens: number | null;
  peakModelCallInputTokens: number | null;
  contextGrowthTokens: number | null;
  modelContextWindow: number | null;
  toolCalls: ToolCallProfile[];
  mcpResponseApproxTokens: number;
  toolResponseApproxTokens: number;
  toolBreakdown: ToolBreakdownProfile[];
  largestResponses: ToolCallProfile[];
  repeatedCalls: ToolBreakdownProfile[];
  shellCalls: ToolCallProfile[];
  timeline: RunProfileTimelineEntry[];
  limitations: string[];
};

export function approxTokens(characters: number) {
  return characters === 0 ? 0 : Math.ceil(characters / 4);
}

export function measureText(value: string): SizeMetric {
  return {
    bytes: Buffer.byteLength(value, "utf8"),
    approxTokens: approxTokens(value.length),
  };
}

export function measureJson(value: unknown): SizeMetric {
  const serialized = JSON.stringify(value) ?? "";
  return measureText(serialized);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function searchResults(value: unknown): ToolCallProfile["searchResults"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const result = record(item);
    return {
      id: string(result.id),
      slug: string(result.slug),
      title: string(result.title) ?? "Untitled result",
      score: nullableNumber(result.score),
    };
  });
}

function parseControlPlaneProfile(
  events: RunEvent[],
): ControlPlaneContextProfile | null {
  const payload = events
    .filter((event) => event.type === "run_context_profile")
    .sort(
      (a, b) => number(b.payload.attempt) - number(a.payload.attempt),
    )[0]?.payload;
  if (!payload) return null;
  return payload as unknown as ControlPlaneContextProfile;
}

function runtimeBootstrapComponents(events: RunEvent[]): ContextComponent[] {
  const payload = events
    .filter((event) => event.type === "runtime_context_bootstrap")
    .sort(
      (a, b) => number(b.payload.attempt) - number(a.payload.attempt),
    )[0]?.payload;
  if (!payload) return [];
  const runnerGenerated = record(payload.runnerGeneratedInstructionsApprox);
  const turnInput = record(payload.turnInputTotal);
  const initialInput = record(payload.initialUserInput);
  const history = record(payload.rehydratedConversationContextApprox);
  const mcpConfiguration = record(payload.mcpConfiguration);
  const turnWrapperTokens = Math.max(
    0,
    number(turnInput.approxTokens) -
      number(initialInput.approxTokens) -
      number(history.approxTokens),
  );
  const turnWrapperBytes = Math.max(
    0,
    number(turnInput.bytes) -
      number(initialInput.bytes) -
      number(history.bytes),
  );
  return [
    {
      key: "runner_generated_instructions",
      label: "Runner-generated instructions",
      bytes: number(runnerGenerated.bytes),
      approxTokens: number(runnerGenerated.approxTokens),
    },
    {
      key: "runner_turn_wrapper",
      label: "Runner conversation wrapper",
      bytes: turnWrapperBytes,
      approxTokens: turnWrapperTokens,
    },
    {
      key: "runtime_mcp_configuration",
      label: "Runtime MCP configuration",
      bytes: number(mcpConfiguration.bytes),
      approxTokens: number(mcpConfiguration.approxTokens),
    },
  ].filter((component) => component.bytes > 0 || component.approxTokens > 0);
}

function modelCalls(events: RunEvent[]): ModelCallProfile[] {
  let previousInput: number | null = null;
  return events
    .filter((event) => event.type === "usage_updated")
    .map((event, index) => {
      const last = record(event.payload.last);
      const inputTokens = number(event.payload.inputTokens ?? last.inputTokens);
      const cachedInputTokens = number(
        event.payload.cachedInputTokens ?? last.cachedInputTokens,
      );
      const call: ModelCallProfile = {
        callIndex: number(event.payload.callIndex) || index + 1,
        createdAt: event.createdAt,
        inputTokens,
        cachedInputTokens,
        uncachedInputTokens: number(
          event.payload.uncachedInputTokens ??
            Math.max(0, inputTokens - cachedInputTokens),
        ),
        outputTokens: number(event.payload.outputTokens ?? last.outputTokens),
        reasoningOutputTokens: number(
          event.payload.reasoningOutputTokens ?? last.reasoningOutputTokens,
        ),
        totalTokens: number(event.payload.totalTokens ?? last.totalTokens),
        modelContextWindow: nullableNumber(event.payload.modelContextWindow),
        inputDeltaTokens:
          previousInput === null ? null : inputTokens - previousInput,
      };
      previousInput = inputTokens;
      return call;
    });
}

function toolCalls(events: RunEvent[]): ToolCallProfile[] {
  const starts = new Map(
    events
      .filter((event) => event.type === "tool_started")
      .map((event) => [String(event.payload.toolId ?? event.id), event]),
  );
  return events
    .filter(
      (event) =>
        event.type === "tool_completed" || event.type === "tool_failed",
    )
    .map((event) => {
      const payload = event.payload;
      const toolId = String(payload.toolId ?? event.id);
      const started = starts.get(toolId);
      const name = string(payload.name) ?? "tool";
      const server =
        string(payload.server) ??
        (payload.kind === "mcpToolCall" ? name.split(".")[0] : "runtime");
      const tool = string(payload.tool) ?? name.split(".").at(-1) ?? name;
      return {
        toolId,
        server,
        tool,
        name,
        kind: string(payload.kind) ?? "tool",
        startedAt:
          string(payload.startedAt) ??
          string(started?.payload.startedAt) ??
          started?.createdAt ??
          null,
        completedAt: string(payload.completedAt) ?? event.createdAt,
        durationMs: nullableNumber(payload.durationMs),
        argumentsBytes: number(payload.argumentsBytes),
        argumentsApproxTokens: number(payload.argumentsApproxTokens),
        argumentsPreview: string(payload.argumentsPreview),
        responseBytes: number(payload.responseBytes),
        responseApproxTokens: number(payload.responseApproxTokens),
        responsePreview: string(payload.responsePreview),
        success: typeof payload.success === "boolean" ? payload.success : null,
        status: string(payload.status),
        reason: string(payload.reason),
        command: string(payload.command),
        exitCode: nullableNumber(payload.exitCode),
        outputBytes: nullableNumber(payload.outputBytes),
        outputApproxTokens: nullableNumber(payload.outputApproxTokens),
        streamBreakdownAvailable:
          typeof payload.streamBreakdownAvailable === "boolean"
            ? payload.streamBreakdownAvailable
            : null,
        debugArgumentsPayload: payload.debugArgumentsPayload ?? null,
        debugResponsePayload: payload.debugResponsePayload ?? null,
        searchQuery: string(payload.searchQuery),
        searchResultCount: nullableNumber(payload.searchResultCount),
        searchResults: searchResults(payload.searchResults),
      } satisfies ToolCallProfile;
    });
}

function toolBreakdown(tools: ToolCallProfile[]): ToolBreakdownProfile[] {
  const grouped = new Map<string, ToolBreakdownProfile>();
  for (const call of tools) {
    const key =
      call.server === "runtime" ? call.tool : `${call.server}.${call.tool}`;
    const current = grouped.get(key) ?? {
      key,
      server: call.server,
      tool: call.tool,
      calls: 0,
      responseBytes: 0,
      responseApproxTokens: 0,
      largestResponseApproxTokens: 0,
    };
    current.calls += 1;
    current.responseBytes += call.responseBytes;
    current.responseApproxTokens += call.responseApproxTokens;
    current.largestResponseApproxTokens = Math.max(
      current.largestResponseApproxTokens,
      call.responseApproxTokens,
    );
    grouped.set(key, current);
  }
  return [...grouped.values()].sort(
    (a, b) => b.responseApproxTokens - a.responseApproxTokens,
  );
}

function correlatedTimeline(
  events: RunEvent[],
  calls: ModelCallProfile[],
  tools: ToolCallProfile[],
): RunProfileTimelineEntry[] {
  if (calls.length === 0) {
    return tools
      .map((tool) => ({ entryType: "tool" as const, ...tool }))
      .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  }

  const usageEventIndexes = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === "usage_updated")
    .map(({ index }) => index);
  const completedToolIndexes = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.type === "tool_completed" || event.type === "tool_failed") {
      completedToolIndexes.set(String(event.payload.toolId ?? event.id), index);
    }
  });
  const toolsAfterCall = new Map<number, ToolCallProfile[]>();
  for (const tool of tools) {
    const eventIndex =
      completedToolIndexes.get(tool.toolId) ?? Number.MAX_SAFE_INTEGER;
    let callPosition = 0;
    for (let index = 0; index < usageEventIndexes.length; index += 1) {
      if ((usageEventIndexes[index] ?? 0) <= eventIndex) callPosition = index;
      else break;
    }
    const bucket = toolsAfterCall.get(callPosition) ?? [];
    bucket.push(tool);
    toolsAfterCall.set(callPosition, bucket);
  }

  return calls.flatMap((call, index): RunProfileTimelineEntry[] => [
    { entryType: "model", ...call },
    ...(toolsAfterCall.get(index) ?? [])
      .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
      .map((tool) => ({ entryType: "tool" as const, ...tool })),
  ]);
}

export function buildRunContextProfile(
  run: Run,
  events: RunEvent[],
): RunContextProfile {
  const controlPlane = parseControlPlaneProfile(events);
  const runtimeComponents = runtimeBootstrapComponents(events);
  const contextComponents = [
    ...(controlPlane?.components ?? []),
    ...runtimeComponents,
  ];
  const definitionsTokens = (controlPlane?.mcpServers ?? []).reduce(
    (total, server) => total + server.approxTokens,
    0,
  );
  const instructionComponentKeys = new Set([
    "agent_instructions",
    "work_coordination_instructions",
    "integration_instructions",
  ]);
  const hasRuntimeMcpConfiguration = contextComponents.some(
    (component) => component.key === "runtime_mcp_configuration",
  );
  const componentTokens = contextComponents.reduce((total, component) => {
    if (instructionComponentKeys.has(component.key)) return total;
    if (
      hasRuntimeMcpConfiguration &&
      component.key === "mcp_server_configuration"
    ) {
      return total;
    }
    return total + component.approxTokens;
  }, 0);
  const knownInitialContextApproxTokens =
    (controlPlane?.instructionBundle.approxTokens ?? 0) +
    componentTokens +
    definitionsTokens;
  const calls = modelCalls(events);
  const tools = toolCalls(events);
  const breakdown = toolBreakdown(tools);
  const initialInput = calls[0]?.inputTokens ?? null;
  const peakInput = calls.length
    ? Math.max(...calls.map((call) => call.inputTokens))
    : null;
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const endedAt = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? Math.max(0, endedAt - startedAt)
      : null;
  const limitations: string[] = [];
  if (tools.some((tool) => tool.tool === "shell")) {
    limitations.push(
      "Codex app-server exposes shell output as one aggregated stream, so stdout and stderr cannot be measured separately.",
    );
  }
  if (!controlPlane) {
    limitations.push(
      "This run predates control-plane bootstrap profiling; only persisted runtime usage is available.",
    );
  }
  if ((controlPlane?.mcpServers ?? []).some((server) => !server.success)) {
    limitations.push(
      "At least one MCP definition probe failed; its schema weight is excluded from the known bootstrap estimate.",
    );
  }
  const timeline = correlatedTimeline(events, calls, tools);

  return {
    captured:
      Boolean(controlPlane) ||
      events.some(
        (event) =>
          event.type === "runtime_context_bootstrap" ||
          number(event.payload.responseBytes) > 0,
      ),
    durationMs,
    knownInitialContextApproxTokens,
    unattributedInitialContextApproxTokens:
      initialInput === null
        ? null
        : Math.max(0, initialInput - knownInitialContextApproxTokens),
    contextComponents,
    mcpServers: controlPlane?.mcpServers ?? [],
    modelCalls: calls,
    cumulativeInputTokens: calls.reduce(
      (total, call) => total + call.inputTokens,
      0,
    ),
    cumulativeCachedInputTokens: calls.reduce(
      (total, call) => total + call.cachedInputTokens,
      0,
    ),
    cumulativeUncachedInputTokens: calls.reduce(
      (total, call) => total + call.uncachedInputTokens,
      0,
    ),
    cumulativeOutputTokens: calls.reduce(
      (total, call) => total + call.outputTokens,
      0,
    ),
    cumulativeReasoningOutputTokens: calls.reduce(
      (total, call) => total + call.reasoningOutputTokens,
      0,
    ),
    initialModelCallInputTokens: initialInput,
    peakModelCallInputTokens: peakInput,
    contextGrowthTokens:
      initialInput === null || peakInput === null
        ? null
        : peakInput - initialInput,
    modelContextWindow:
      [...calls].reverse().find((call) => call.modelContextWindow !== null)
        ?.modelContextWindow ?? null,
    toolCalls: tools,
    mcpResponseApproxTokens: tools
      .filter((tool) => tool.server !== "runtime")
      .reduce((total, tool) => total + tool.responseApproxTokens, 0),
    toolResponseApproxTokens: tools.reduce(
      (total, tool) => total + tool.responseApproxTokens,
      0,
    ),
    toolBreakdown: breakdown,
    largestResponses: tools
      .filter((tool) => tool.responseBytes > 0 || tool.responseApproxTokens > 0)
      .sort((a, b) => b.responseApproxTokens - a.responseApproxTokens)
      .slice(0, 8),
    repeatedCalls: breakdown.filter((tool) => tool.calls > 1),
    shellCalls: tools.filter((tool) => tool.tool === "shell"),
    timeline,
    limitations,
  };
}
