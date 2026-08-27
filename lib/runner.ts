import { agentRepository } from "@/lib/repositories/agent-repository";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";
import "server-only";

import { randomUUID } from "node:crypto";

import { getSetting } from "@/lib/settings";
import type { Agent, Message, Thread } from "@/lib/types";
import {
  EMAIL_AGENT_PROMPT,
  CALENDAR_AGENT_PROMPT,
  POSTHOG_AGENT_PROMPT,
} from "@/lib/integrations/catalog";
import { getAgentEmailMcp } from "@/lib/integrations/email-service";
import { getAgentCalendarIntegrationsMcp } from "@/lib/integrations/calendar-service";
import {
  getAgentCustomIntegrationsMcp,
  getAgentPostHogMcp,
} from "@/lib/integrations/service";
import { inspectMcpDefinitions } from "@/lib/mcp/client";
import {
  RunnerBudgetCompatibilityError,
  RunnerRequestError,
} from "@/lib/runner-errors";
import { OperationalError } from "@/lib/operational-error";
import { readSecret } from "@/lib/server-config";
import type { RunExecution } from "@/lib/run-execution";
import type { RuntimeBudget } from "@/lib/budget-control";
import {
  getRuntimeAuthentication,
  getRuntimeConfig,
  isRuntimeId,
  runtimeBudgetCapabilities,
} from "@/lib/runtime-config";
import {
  attachRunnerTransport,
  createRunnerTransport,
} from "@/lib/runner-transport";
import {
  measureJson,
  measureText,
  type ContextComponent,
  type ControlPlaneContextProfile,
} from "@/lib/run-context-profile";
import { createWorkCoordinationContext } from "@/lib/agent-directory";
import type { MemoryRecall } from "@/lib/memory/service";
import {
  filterExposedToolsByPolicy,
  snapshotAgentToolPolicies,
  type PolicyAwareMcpServer,
} from "@/lib/agent-tool-policy";
import {
  buildAgentToolCatalog,
  coreToolDefinitions,
  integrationServerName,
} from "@/lib/agent-tool-catalog";
import type {
  CodexAuthStatus,
  CodexDeviceLogin,
  CodexLoginStatus,
} from "@/lib/codex-auth-contract";
import { codexLoginIdPattern } from "@/lib/codex-auth-contract";

export type { RunnerEvent } from "@/lib/runner-transport";

type RunnerRuntimeDependencies = {
  fetcher?: typeof fetch;
  retryDelay?: (attempt: number) => Promise<void>;
};

const runnerUrl = () => getSetting("runner_url").replace(/\/$/, "");

async function assertRunnerBudgetSupport(
  runtimeId: string,
  budget: RuntimeBudget | null | undefined,
  fetcher: typeof fetch,
) {
  if (!budget || (budget.maxTokens === null && budget.maxCostUsd === null)) {
    return;
  }
  if (!isRuntimeId(runtimeId)) {
    throw new RunnerBudgetCompatibilityError(
      `Runtime ${runtimeId} cannot prove budget enforcement.`,
    );
  }
  const local = runtimeBudgetCapabilities[runtimeId];
  const requiresIncrementalToken =
    budget.maxTokens !== null && local.incrementalTokenUsage;
  const requiresNativeToken =
    budget.maxTokens !== null && !local.incrementalTokenUsage;
  const requiresIncrementalCost =
    budget.maxCostUsd !== null &&
    Boolean(budget.pricing) &&
    local.incrementalTokenUsage;
  const requiresNativeCost =
    budget.maxCostUsd !== null &&
    !(budget.pricing && local.incrementalTokenUsage);

  let runtimes: RunnerRuntimeSummary[];
  try {
    runtimes = await listRunnerRuntimes(fetcher);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Runtime catalog unavailable.";
    throw new RunnerBudgetCompatibilityError(
      `Runner budget capabilities could not be verified: ${detail}`,
    );
  }
  const runtime = runtimes.find(({ id }) => id === runtimeId);
  const supportsIncremental =
    runtime?.capabilities.budgetIncrementalUsage === true;
  const supportsToken = runtime?.capabilities.budgetNativeTokenLimit === true;
  const supportsCost = runtime?.capabilities.budgetNativeCostLimit === true;
  if (
    !runtime ||
    ((requiresIncrementalToken || requiresIncrementalCost) &&
      !supportsIncremental) ||
    (requiresNativeToken && !supportsToken) ||
    (requiresNativeCost && !supportsCost)
  ) {
    throw new RunnerBudgetCompatibilityError(
      `The connected Runner does not advertise the budget enforcement required by ${runtimeId}. Upgrade Runner before starting this limited run.`,
    );
  }
}

export type RunnerRuntimeSummary = {
  id: string;
  displayName: string;
  stability: "stable" | "experimental";
  authModes: string[];
  capabilities: Record<string, boolean>;
  available: boolean;
  status: "available" | "authentication_required" | "unavailable";
  reasonCode: string;
  authentication: { status: string; mode: string | null };
  checkedAt: string;
};

function runnerHeaders(headers: Record<string, string> = {}) {
  const token = readSecret("RUNNER_TOKEN", "RUNNER_TOKEN_FILE");
  return {
    ...headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function runnerError(response: Response) {
  const body = await readRunnerJson(response).catch(() => null);
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

async function readRunnerJson(
  response: Response,
  maximumBytes = 65_536,
): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RunnerRequestError("Runner response was too large.", 502);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    );
  } catch {
    throw new RunnerRequestError("Runner returned an invalid response.", 502);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOptionalString(
  value: unknown,
  maximumLength: number,
): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

const codexLoginStatuses = new Set<CodexLoginStatus>([
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

function parseCodexDeviceLogin(value: unknown): CodexDeviceLogin {
  if (!isRecord(value)) {
    throw new RunnerRequestError(
      "Runner returned an invalid Codex authentication response.",
      502,
    );
  }
  const { loginId, verificationUrl, userCode, status, expiresAt } = value;
  let url: URL;
  try {
    url = new URL(String(verificationUrl));
  } catch {
    throw new RunnerRequestError(
      "Runner returned an invalid Codex authentication response.",
      502,
    );
  }
  if (
    typeof loginId !== "string" ||
    !codexLoginIdPattern.test(loginId) ||
    typeof userCode !== "string" ||
    userCode.length === 0 ||
    userCode.length > 64 ||
    [...userCode].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    }) ||
    typeof status !== "string" ||
    !codexLoginStatuses.has(status as CodexLoginStatus) ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    url.protocol !== "https:" ||
    Boolean(url.username || url.password) ||
    (url.hostname !== "openai.com" && !url.hostname.endsWith(".openai.com"))
  ) {
    throw new RunnerRequestError(
      "Runner returned an invalid Codex authentication response.",
      502,
    );
  }
  return {
    loginId,
    verificationUrl: url.toString(),
    userCode,
    status: status as CodexLoginStatus,
    expiresAt,
  };
}

function parseCodexAuthStatus(value: unknown): CodexAuthStatus {
  if (!isRecord(value)) {
    throw new RunnerRequestError(
      "Runner returned an invalid Codex authentication response.",
      502,
    );
  }
  const status = value.status;
  const authMode = value.authMode;
  if (
    !new Set(["authenticated", "not_authenticated", "unavailable"]).has(
      String(status),
    ) ||
    !new Set([null, "chatgpt", "api_key", "cloud_provider", "unknown"]).has(
      authMode as string | null,
    )
  ) {
    throw new RunnerRequestError(
      "Runner returned an invalid Codex authentication response.",
      502,
    );
  }
  return {
    status: status as CodexAuthStatus["status"],
    authMode: authMode as CodexAuthStatus["authMode"],
    email: parseOptionalString(value.email, 320),
    planType: parseOptionalString(value.planType, 100),
    login: value.login === null ? null : parseCodexDeviceLogin(value.login),
  };
}

async function codexAuthRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    fetcher?: typeof fetch;
    parse: (value: unknown) => T;
  },
): Promise<T> {
  const response = await (options.fetcher ?? fetch)(`${runnerUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: runnerHeaders({ Accept: "application/json" }),
    signal: AbortSignal.timeout(options.method === "GET" ? 5_000 : 15_000),
    cache: "no-store",
  });
  if (!response.ok) throw await runnerError(response);
  const payload = await readRunnerJson(response);
  if (!isRecord(payload) || !("data" in payload)) {
    throw new RunnerRequestError(
      "Runner returned an invalid Codex authentication response.",
      502,
    );
  }
  return options.parse(payload.data);
}

export function getCodexAuthStatus(fetcher: typeof fetch = fetch) {
  return codexAuthRequest("/auth/codex", {
    fetcher,
    parse: parseCodexAuthStatus,
  });
}

export function startCodexDeviceLogin(fetcher: typeof fetch = fetch) {
  return codexAuthRequest("/auth/codex/device-login", {
    method: "POST",
    fetcher,
    parse: parseCodexDeviceLogin,
  });
}

export function cancelCodexDeviceLogin(
  loginId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!codexLoginIdPattern.test(loginId)) {
    throw new RunnerRequestError("Invalid Codex authentication login ID.", 400);
  }
  return codexAuthRequest(
    `/auth/codex/device-login/${encodeURIComponent(loginId)}`,
    {
      method: "DELETE",
      fetcher,
      parse: parseCodexDeviceLogin,
    },
  );
}

export function logoutCodex(fetcher: typeof fetch = fetch) {
  return codexAuthRequest("/auth/codex/logout", {
    method: "POST",
    fetcher,
    parse: parseCodexAuthStatus,
  });
}

export async function startRunnerRun(
  input: {
    runId: string;
    controlPlaneRunId?: string;
    agent: Agent;
    thread: Thread;
    messages: Message[];
    prompt: string;
    execution: RunExecution;
    memory?: MemoryRecall | null;
    budget?: RuntimeBudget | null;
    attachOnly?: boolean;
    runnerEventCursor?: number;
  },
  dependencies: RunnerRuntimeDependencies = {},
) {
  const baseUrl = runnerUrl();
  const transportHeaders = runnerHeaders({
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  const attached = await attachRunnerTransport({
    baseUrl,
    runId: input.runId,
    headers: transportHeaders,
    afterEventId: input.runnerEventCursor,
    fetcher: dependencies.fetcher,
    errorFromResponse: runnerError,
    retryDelay: dependencies.retryDelay,
  });
  if (attached) {
    return {
      events: attached.events,
      resumed: true,
      runnerStatus: attached.runnerStatus,
      contextProfile: null,
      capabilitySnapshot: null,
    };
  }
  if (input.attachOnly) {
    throw new RunnerRequestError(
      "Budget-exceeded Runner execution is no longer available.",
      410,
    );
  }
  await assertRunnerBudgetSupport(
    input.agent.runtime,
    input.budget,
    dependencies.fetcher ?? fetch,
  );

  const contextMessages =
    input.messages.at(-1)?.role === "user" &&
    input.messages.at(-1)?.body === input.prompt
      ? input.messages.slice(0, -1)
      : input.messages;
  const workApiKey = getSetting("work_api_key");
  const docsApiKey = getSetting("docs_api_key");
  const configuredIntegrations = integrationRepository.listIntegrations();
  const configuredEmailAccess = emailAccessRepository.getAgentEmailAccess(
    input.agent.id,
  );
  const posthogMcp = getAgentPostHogMcp(input.agent.id);
  const emailMcp = getAgentEmailMcp(input.agent.id);
  const customIntegrations = getAgentCustomIntegrationsMcp(
    input.agent.id,
    input.controlPlaneRunId ?? input.runId,
  );
  const customMcpServers = customIntegrations.map(({ server }) => server);
  const calendarIntegrations = getAgentCalendarIntegrationsMcp(
    input.agent.id,
    input.controlPlaneRunId ?? input.runId,
  );
  const calendarMcpServers = calendarIntegrations.map(({ server }) => server);
  const exposedToolsByServer = new Map(
    buildAgentToolCatalog({
      agent: input.agent,
      integrations: configuredIntegrations,
      emailAccess: configuredEmailAccess,
    }).map((server) => {
      if (!server.integrationId) {
        return [
          server.serverName,
          server.tools.map(({ name }) => name),
        ] as const;
      }
      const integration = configuredIntegrations.find(
        ({ id }) => id === server.integrationId,
      );
      const assigned = new Set(integration?.permissions[input.agent.id] ?? []);
      return [
        server.serverName,
        server.tools
          .map(({ name }) => name)
          .filter((tool) => assigned.has(tool)),
      ] as const;
    }),
  );
  for (const { server, snapshot } of [
    ...calendarIntegrations,
    ...customIntegrations,
  ]) {
    exposedToolsByServer.set(server.name, snapshot.tools);
  }
  const liveMcpServers: PolicyAwareMcpServer[] = [
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
    ...(emailMcp ? [emailMcp] : []),
    ...calendarMcpServers,
    ...customMcpServers,
  ];
  const policyRunId = input.controlPlaneRunId ?? input.runId;
  const { servers: mcpServers, snapshot: toolPolicySnapshot } =
    snapshotAgentToolPolicies({
      runId: policyRunId,
      agent: input.agent,
      servers: liveMcpServers,
    });
  const effectiveToolsByServer = new Map(
    mcpServers.map(({ name }) => [
      name,
      filterExposedToolsByPolicy(
        toolPolicySnapshot.policies[name],
        exposedToolsByServer.get(name) ?? [],
      ),
    ]),
  );
  const availableServerNames = new Set(
    mcpServers
      .filter(({ name }) => (effectiveToolsByServer.get(name)?.length ?? 0) > 0)
      .map(({ name }) => name),
  );
  const currentPolicies = agentToolPolicyRepository.listAll();
  const directoryPolicies = [
    ...currentPolicies.filter(({ agentId }) => agentId !== input.agent.id),
    ...Object.entries(toolPolicySnapshot.policies).map(
      ([serverName, policy]) => ({
        agentId: input.agent.id,
        serverName,
        ...policy,
      }),
    ),
  ];
  const workCoordination = createWorkCoordinationContext({
    agents: agentRepository.listAgents(),
    integrations: configuredIntegrations.map((integration) => ({
      ...integration,
      serverName: integrationServerName(integration),
    })),
    emailAccess: emailAccessRepository.listAgentEmailAccess(),
    toolPolicies: directoryPolicies,
    coreTools: coreToolDefinitions(),
    currentAgentId: input.agent.id,
    currentRunToolsByServer: Object.fromEntries(effectiveToolsByServer),
    currentRunWorkTools: effectiveToolsByServer.get("work") ?? [],
    emailConnected:
      emailAccessRepository.getEmailIntegrationRecord()?.status === "connected",
  });
  const workInstructions = workCoordination.instructions;
  const integrationInstructions = [
    ...(posthogMcp && availableServerNames.has(posthogMcp.name)
      ? [POSTHOG_AGENT_PROMPT]
      : []),
    ...(emailMcp && availableServerNames.has(emailMcp.name)
      ? [EMAIL_AGENT_PROMPT]
      : []),
    ...(calendarMcpServers.some(({ name }) => availableServerNames.has(name))
      ? [CALENDAR_AGENT_PROMPT]
      : []),
  ].join("\n\n");
  const instructionParts = [
    input.agent.instructions,
    workInstructions,
    input.execution.policy,
    ...(input.memory?.context ? [input.memory.context] : []),
    ...(integrationInstructions ? [integrationInstructions] : []),
  ];
  const combinedInstructions = instructionParts.join("\n\n");
  const shouldRehydrateConversation =
    input.execution.mode === "chat" &&
    (!input.thread.runtimeThreadId || input.agent.runtime === "direct_api");
  const context = shouldRehydrateConversation
    ? contextMessages
        .filter(({ role }) => role === "user" || role === "assistant")
        .slice(-12)
        .map(({ role, body }) => ({ role, body }))
    : [];
  const components: ContextComponent[] = [
    {
      key: "agent_instructions",
      label: "Agent instructions",
      ...measureText(input.agent.instructions),
    },
    {
      key: "agent_directory",
      label: `Enabled agent directory (${workCoordination.directory.entries.length} agents)`,
      ...measureText(workCoordination.directoryInstructions),
    },
    {
      key: "work_coordination_instructions",
      label: "Control-plane Work coordination instructions",
      ...measureText(workCoordination.coordinationInstructions),
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
      key: "long_term_memory",
      label: `Long-term memory (${input.memory?.provider ?? "disabled"}: ${input.memory?.status ?? "disabled"})`,
      ...measureText(input.memory?.context ?? ""),
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
  const transport = await createRunnerTransport({
    baseUrl,
    runId: input.runId,
    headers: transportHeaders,
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
        authentication: getRuntimeAuthentication(input.agent.runtime),
      },
      budget: input.budget ?? null,
      thread: { runtimeThreadId: input.thread.runtimeThreadId },
      message: input.prompt,
      context,
      mcpServers,
      cwd: null,
    }),
    afterEventId: input.runnerEventCursor,
    fetcher: dependencies.fetcher,
    errorFromResponse: runnerError,
    retryDelay: dependencies.retryDelay,
  });
  return {
    events: transport.events,
    resumed: transport.resumed,
    runnerStatus: transport.runnerStatus,
    contextProfile,
    capabilitySnapshot: {
      capturedAt: new Date().toISOString(),
      semantics: "snapshot_at_run_start",
      serverCount: mcpServers.length,
      servers: mcpServers.map((server) => server.name),
      customIntegrations: customIntegrations.map(({ snapshot }) => snapshot),
      calendarIntegrations: calendarIntegrations.map(
        ({ snapshot }) => snapshot,
      ),
      toolPolicies: {
        snapshotId: toolPolicySnapshot.runId,
        capturedAt: toolPolicySnapshot.capturedAt,
        policies: toolPolicySnapshot.policies,
      },
      agentDirectory: workCoordination.directory,
      memory: {
        provider: input.memory?.provider ?? "disabled",
        status: input.memory?.status ?? "disabled",
        approxTokens: input.memory?.approxTokens ?? 0,
        truncated: input.memory?.truncated ?? false,
      },
      changesApplyTo: "next_run",
      runtime: {
        id: input.agent.runtime,
        model: input.agent.model,
        configVersion: isRuntimeId(input.agent.runtime)
          ? getRuntimeConfig(input.agent.runtime).configVersion
          : null,
      },
    },
  };
}

export async function cancelRunnerRun(runId: string) {
  const response = await fetch(
    `${runnerUrl()}/runs/${encodeURIComponent(runId)}`,
    {
      method: "DELETE",
      headers: runnerHeaders(),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok && response.status !== 404)
    throw await runnerError(response);
  return response.ok;
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

export async function listRunnerRuntimes(
  fetcher: typeof fetch = fetch,
): Promise<RunnerRuntimeSummary[]> {
  const response = await fetcher(`${runnerUrl()}/runtimes`, {
    headers: runnerHeaders(),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw await runnerError(response);
  const payload = (await response.json()) as { data?: RunnerRuntimeSummary[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function testRunnerRuntime(runtimeId: string) {
  const runtime = (await listRunnerRuntimes()).find(
    (candidate) => candidate.id === runtimeId,
  );
  if (!runtime)
    throw new Error(`Runner did not report the ${runtimeId} runtime.`);
  if (!runtime.available)
    throw new Error(
      runtimeId === "codex"
        ? "Codex is not authenticated or unavailable. Connect ChatGPT in Runtime settings."
        : `${runtimeId} is not authenticated or unavailable. On a self-hosted server, run sudo slabctl ${runtimeId} login.`,
    );
  return runtime;
}

export async function testCodexRuntime() {
  return testRunnerRuntime("codex");
}

export async function runStatelessConfigurationAssistant(
  input: {
    instructions: string;
    message: string;
    timeoutMs?: number;
  },
  dependencies: { fetcher?: typeof fetch } = {},
) {
  const baseUrl = runnerUrl();
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? 90_000, 10_000),
    120_000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const baseFetcher = dependencies.fetcher ?? fetch;
  const fetcher: typeof fetch = (resource, init = {}) =>
    baseFetcher(resource, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal,
    });
  const runId = `configuration-assistant-${randomUUID()}`;
  const headers = runnerHeaders({
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  try {
    const config = getRuntimeConfig("codex");
    const runtime = (await listRunnerRuntimes(fetcher)).find(
      ({ id }) => id === "codex",
    );
    if (!config.enabled || runtime?.status !== "available") {
      throw new OperationalError(
        "Codex must be enabled and authenticated to edit integrations with AI.",
        "AI_ASSISTANT_UNAVAILABLE",
        503,
      );
    }
    const model =
      config.defaultModel === "default" ? null : config.defaultModel;
    const transport = await createRunnerTransport({
      baseUrl,
      runId,
      headers,
      fetcher,
      errorFromResponse: runnerError,
      body: JSON.stringify({
        runId,
        agent: {
          id: "slab-configuration-assistant",
          name: "Slab configuration assistant",
          role: "Edit declarative integration manifests",
          instructions: input.instructions,
          fullAccess: false,
        },
        runtime: {
          type: "codex",
          model,
          authentication: null,
        },
        budget: null,
        thread: { runtimeThreadId: null },
        message: input.message,
        context: [],
        mcpServers: [],
        cwd: null,
      }),
    });
    let message = "";
    let totalTokens: number | null = null;
    for await (const event of transport.events) {
      if (event.type === "assistant.delta") {
        message += String(event.data.delta ?? "");
      } else if (event.type === "assistant.completed") {
        message = String(event.data.message ?? message);
      } else if (event.type === "usage.updated") {
        const observed = Number(event.data.totalTokens);
        if (Number.isFinite(observed) && observed >= 0) {
          totalTokens = Math.max(totalTokens ?? 0, observed);
        }
      } else if (event.type === "approval.required") {
        const approvalId = String(event.data.approvalId ?? "");
        if (approvalId) {
          await fetcher(
            `${baseUrl}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ decision: "deny" }),
              cache: "no-store",
            },
          ).catch(() => null);
        }
        throw new OperationalError(
          "The configuration assistant attempted to use a runtime tool. No changes were proposed.",
          "AI_ASSISTANT_TOOL_REQUESTED",
          502,
        );
      } else if (event.type === "tool.started") {
        throw new OperationalError(
          "The configuration assistant attempted to use a runtime tool. No changes were proposed.",
          "AI_ASSISTANT_TOOL_REQUESTED",
          502,
        );
      } else if (event.type === "run.failed") {
        throw new OperationalError(
          String(event.data.message ?? "The configuration assistant failed."),
          "AI_ASSISTANT_FAILED",
          502,
        );
      } else if (event.type === "run.cancelled") {
        throw new OperationalError(
          "The configuration assistant was cancelled.",
          "AI_ASSISTANT_CANCELLED",
          502,
        );
      }
    }
    if (!message.trim()) {
      throw new OperationalError(
        "The configuration assistant returned an empty response.",
        "AI_ASSISTANT_INVALID_RESPONSE",
        502,
      );
    }
    if (Buffer.byteLength(message, "utf8") > 200_000) {
      throw new OperationalError(
        "The configuration assistant response was too large.",
        "AI_ASSISTANT_INVALID_RESPONSE",
        502,
      );
    }
    return { message, runtime: { id: "codex", model }, usage: { totalTokens } };
  } catch (error) {
    await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
      headers: runnerHeaders(),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (controller.signal.aborted) {
      throw new OperationalError(
        "The configuration assistant timed out.",
        "AI_ASSISTANT_TIMEOUT",
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
