import "server-only";

import { getSetting } from "@/lib/settings";
import { repository } from "@/lib/repository";
import type { Agent, Message, Thread } from "@/lib/types";
import { POSTHOG_AGENT_PROMPT } from "@/lib/integrations/catalog";
import { getAgentPostHogMcp } from "@/lib/integrations/service";
import { inspectMcpDefinitions } from "@/lib/mcp/client";
import { RunnerRequestError } from "@/lib/runner-errors";
import type { RunExecution } from "@/lib/run-execution";
import {
  measureJson,
  measureText,
  type ContextComponent,
  type ControlPlaneContextProfile,
} from "@/lib/run-context-profile";

export type RunnerEvent = {
  id: number;
  type:
    | "run.started"
    | "context.bootstrap"
    | "thread.created"
    | "assistant.delta"
    | "assistant.completed"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "runtime.warning"
    | "approval.required"
    | "approval.resolved"
    | "usage.updated"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
};

const terminalEvents = new Set<RunnerEvent["type"]>([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

const runnerUrl = () => getSetting("runner_url").replace(/\/$/, "");

function workCoordinationContext() {
  const agents = repository
    .listAgents()
    .filter((agent) => agent.enabled)
    .map((agent) => `- ${agent.name}: assignee slug \`${agent.slug}\``)
    .join("\n");
  return [
    "Work coordination in this local control plane:",
    agents || "- No other enabled agents are currently registered.",
    "Assigning a Work item to an enabled agent slug starts that agent automatically.",
    "Work comments can mention an agent by slug (for example @coo or @sales) to request its input.",
    "Use Work items and comments—not direct agent messages—for delegation, execution, review, and operational decisions.",
    'Slab supports new, in_progress, and done natively. Represent review as in_progress + label "status:review", and blocked as in_progress + label "status:blocked". Remove those labels when leaving the semantic state.',
  ].join("\n");
}

function runnerHeaders(headers: Record<string, string> = {}) {
  const token = process.env.RUNNER_TOKEN?.trim();
  return {
    ...headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function runnerError(response: Response) {
  const body = await response.json().catch(() => null);
  const message =
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error
      ? String(body.error.message)
      : `Runner returned ${response.status}`;
  return new RunnerRequestError(message, response.status);
}

function parseEventBlock(block: string): RunnerEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as RunnerEvent;
  } catch {
    return null;
  }
}

async function* parseEventStream(
  response: Response,
): AsyncGenerator<RunnerEvent> {
  if (!response.body) throw new Error("Runner returned an empty event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) yield event;
    }
    if (done) break;
  }
  const event = parseEventBlock(buffer);
  if (event) yield event;
}

async function* streamRunnerEvents(runId: string) {
  let lastEventId = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(
      `${runnerUrl()}/runs/${encodeURIComponent(runId)}/events`,
      {
        headers: runnerHeaders({
          Accept: "text/event-stream",
          ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
        }),
        cache: "no-store",
      },
    );
    if (!response.ok) throw await runnerError(response);
    for await (const event of parseEventStream(response)) {
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      yield event;
      if (terminalEvents.has(event.type)) return;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw new Error("Runner event stream ended before the run completed.");
}

export async function startRunnerRun(input: {
  runId: string;
  agent: Agent;
  thread: Thread;
  messages: Message[];
  prompt: string;
  execution: RunExecution;
}) {
  const contextMessages =
    input.messages.at(-1)?.role === "user" &&
    input.messages.at(-1)?.body === input.prompt
      ? input.messages.slice(0, -1)
      : input.messages;
  const workApiKey = getSetting("work_api_key");
  const docsApiKey = getSetting("docs_api_key");
  const posthogMcp = getAgentPostHogMcp(input.agent.id);
  const workInstructions = workCoordinationContext();
  const integrationInstructions = posthogMcp ? POSTHOG_AGENT_PROMPT : "";
  const instructionParts = [
    input.agent.instructions,
    workInstructions,
    input.execution.policy,
    ...(integrationInstructions ? [integrationInstructions] : []),
  ];
  const combinedInstructions = instructionParts.join("\n\n");
  const shouldRehydrateConversation =
    input.execution.mode === "chat" && !input.thread.runtimeThreadId;
  const context = shouldRehydrateConversation
    ? contextMessages
        .filter(({ role }) => role === "user" || role === "assistant")
        .slice(-12)
        .map(({ role, body }) => ({ role, body }))
    : [];
  const mcpServers = [
    {
      name: "work" as const,
      url: getSetting("work_mcp_url"),
      ...(workApiKey ? { credentials: { bearerToken: workApiKey } } : {}),
    },
    {
      name: "docs" as const,
      url: getSetting("docs_mcp_url"),
      ...(docsApiKey ? { credentials: { bearerToken: docsApiKey } } : {}),
    },
    ...(posthogMcp ? [posthogMcp] : []),
  ];
  const components: ContextComponent[] = [
    {
      key: "agent_instructions",
      label: "Agent instructions",
      ...measureText(input.agent.instructions),
    },
    {
      key: "work_coordination_instructions",
      label: "Control-plane Work coordination instructions",
      ...measureText(workInstructions),
    },
    {
      key: "run_policy",
      label: `${input.execution.mode} run policy`,
      ...measureText(input.execution.policy),
    },
    {
      key: "execution_metadata",
      label: "Execution trigger, mode, and scope",
      ...measureJson({
        trigger: input.execution.trigger,
        mode: input.execution.mode,
        issueKey: input.execution.issueKey,
      }),
    },
    {
      key: "integration_instructions",
      label: "Integration instructions",
      ...measureText(integrationInstructions),
    },
    {
      key: "initial_user_input",
      label: "Initial user / task input",
      ...measureText(input.prompt),
    },
    {
      key: "rehydrated_conversation_context",
      label: `Rehydrated product conversation (${context.length} messages)`,
      ...measureText(
        context
          .map(({ role, body }) => `${role.toUpperCase()}: ${body}`)
          .join("\n\n"),
      ),
    },
    {
      key: "mcp_server_configuration",
      label: "MCP server configuration",
      ...measureJson(mcpServers),
    },
  ];
  const contextProfile = Promise.all(
    mcpServers.map((server) => {
      const token = server.credentials?.bearerToken;
      return inspectMcpDefinitions(server.name, {
        url: server.url,
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
              "X-API-Key": token,
            }
          : {},
      });
    }),
  ).then((mcpDefinitions): ControlPlaneContextProfile => ({
    estimator: "characters_divided_by_4",
    capturedAt: new Date().toISOString(),
    instructionBundle: measureText(combinedInstructions),
    components,
    mcpServers: mcpDefinitions,
  }));
  const response = await fetch(`${runnerUrl()}/runs`, {
    method: "POST",
    headers: runnerHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      runId: input.runId,
      agent: {
        id: input.agent.id,
        name: input.agent.name,
        role: input.agent.role,
        instructions: combinedInstructions,
        fullAccess: input.agent.fullAccess,
      },
      runtime: {
        type: input.agent.runtime,
        model: input.agent.model === "default" ? null : input.agent.model,
      },
      thread: { runtimeThreadId: input.thread.runtimeThreadId },
      message: input.prompt,
      context,
      mcpServers,
      cwd: null,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw await runnerError(response);
  const acknowledgement = (await response.json()) as {
    runId?: string;
    status?: string;
  };
  if (acknowledgement.runId !== input.runId) {
    throw new Error("Runner acknowledged a different run identifier.");
  }
  return {
    events: streamRunnerEvents(input.runId),
    contextProfile,
    capabilitySnapshot: {
      capturedAt: new Date().toISOString(),
      semantics: "snapshot_at_run_start",
      serverCount: mcpServers.length,
      servers: mcpServers.map((server) => server.name),
      changesApplyTo: "next_run",
    },
  };
}

export async function resolveRunnerApproval(
  runId: string,
  approvalId: string,
  decision: "approve" | "deny",
) {
  const response = await fetch(
    `${runnerUrl()}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: "POST",
      headers: runnerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ decision }),
    },
  );
  if (!response.ok) throw await runnerError(response);
  return response.json().catch(() => ({ ok: true }));
}

export async function testRunner() {
  const response = await fetch(`${runnerUrl()}/health`, {
    headers: runnerHeaders(),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw await runnerError(response);
  return response.json().catch(() => ({ status: "ok" }));
}

export async function testCodexRuntime() {
  const response = await fetch(`${runnerUrl()}/runtimes`, {
    headers: runnerHeaders(),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw await runnerError(response);
  const payload = (await response.json()) as {
    data?: { id?: string; available?: boolean }[];
  };
  const codex = payload.data?.find((runtime) => runtime.id === "codex");
  if (!codex) throw new Error("Runner did not report the Codex runtime.");
  if (!codex.available) throw new Error("Codex is not available in Runner.");
  return codex;
}
