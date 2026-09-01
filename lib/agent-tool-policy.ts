import "server-only";

import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";
import { effectiveAgentPermissionMode } from "@/lib/agent-permissions";
import type {
  Agent,
  AgentToolCatalogServer,
  RunToolPolicySnapshot,
  ToolPolicyMode,
} from "@/lib/types";

export type McpToolPolicy = {
  defaultMode: ToolPolicyMode;
  tools: Record<string, ToolPolicyMode>;
};

export type PolicyAwareMcpServer = {
  name: string;
  url: string;
  credentials?: {
    bearerToken: string;
    headers?: Record<string, string>;
  };
  approval?: McpToolPolicy;
};

const toolPolicyModes = new Set<ToolPolicyMode>([
  "approve",
  "prompt",
  "deny",
]);

export function parseToolPolicyOverrides(
  value: unknown,
): Record<string, McpToolPolicy> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, McpToolPolicy> = {};
  for (const [serverName, rawPolicy] of Object.entries(value)) {
    if (
      !rawPolicy ||
      typeof rawPolicy !== "object" ||
      Array.isArray(rawPolicy)
    ) {
      return undefined;
    }
    const policy = rawPolicy as Record<string, unknown>;
    if (!toolPolicyModes.has(policy.defaultMode as ToolPolicyMode)) {
      return undefined;
    }
    if (
      !policy.tools ||
      typeof policy.tools !== "object" ||
      Array.isArray(policy.tools)
    ) {
      return undefined;
    }
    const tools: Record<string, ToolPolicyMode> = {};
    for (const [tool, mode] of Object.entries(policy.tools)) {
      if (!toolPolicyModes.has(mode as ToolPolicyMode)) return undefined;
      tools[tool] = mode as ToolPolicyMode;
    }
    result[serverName] = {
      defaultMode: policy.defaultMode as ToolPolicyMode,
      tools,
    };
  }
  return result;
}

const READ_ONLY_TOOLS: Record<string, readonly string[]> = {
  work: [
    "list_projects",
    "get_project",
    "list_issues",
    "get_issue",
    "search_issues",
    "list_comments",
    "list_links",
    "get_blocked_issues",
    "get_issue_history",
  ],
  docs: [
    "list_docs",
    "search_docs",
    "get_doc",
    "list_doc_revisions",
    "get_doc_revision",
  ],
};

const rank: Record<ToolPolicyMode, number> = {
  approve: 0,
  prompt: 1,
  deny: 2,
};

function stricter(left: ToolPolicyMode, right: ToolPolicyMode) {
  return rank[left] >= rank[right] ? left : right;
}

function modeFor(policy: McpToolPolicy, tool: string) {
  return Object.prototype.hasOwnProperty.call(policy.tools, tool)
    ? policy.tools[tool]!
    : policy.defaultMode;
}

export function policyExposesAnyTool(
  policy: McpToolPolicy | undefined,
  exposedTools: readonly string[],
) {
  return filterExposedToolsByPolicy(policy, exposedTools).length > 0;
}

export function filterExposedToolsByPolicy(
  policy: McpToolPolicy | undefined,
  exposedTools: readonly string[],
) {
  if (!policy) return [];
  return exposedTools.filter((tool) => modeFor(policy, tool) !== "deny");
}

function combinePolicies(
  agentPolicy: McpToolPolicy,
  connectorPolicy: McpToolPolicy,
): McpToolPolicy {
  const tools = new Set([
    ...Object.keys(agentPolicy.tools),
    ...Object.keys(connectorPolicy.tools),
  ]);
  return {
    defaultMode: stricter(agentPolicy.defaultMode, connectorPolicy.defaultMode),
    tools: Object.fromEntries(
      [...tools].map((tool) => [
        tool,
        stricter(modeFor(agentPolicy, tool), modeFor(connectorPolicy, tool)),
      ]),
    ),
  };
}

function guardedPolicy(
  agent: Agent,
  server: PolicyAwareMcpServer,
): McpToolPolicy {
  if (server.approval) return server.approval;
  if (agent.fullAccess) return { defaultMode: "approve", tools: {} };
  return {
    defaultMode: "prompt",
    tools: Object.fromEntries(
      (READ_ONLY_TOOLS[server.name] ?? []).map((tool) => [tool, "approve"]),
    ),
  };
}

function presetPolicy(
  agent: Agent,
  server: PolicyAwareMcpServer,
  catalog: AgentToolCatalogServer | undefined,
): McpToolPolicy {
  const permissionMode = effectiveAgentPermissionMode(agent);
  if (permissionMode === "yolo") {
    return { defaultMode: "approve", tools: {} };
  }
  if (permissionMode !== "full") return guardedPolicy(agent, server);

  const fullPolicy: McpToolPolicy = {
    defaultMode: "approve",
    tools: Object.fromEntries(
      (catalog?.tools ?? [])
        .filter(({ sensitiveAction }) => sensitiveAction !== null)
        .map(({ name }) => [name, "prompt" as const]),
    ),
  };
  return server.approval
    ? combinePolicies(fullPolicy, server.approval)
    : fullPolicy;
}

function livePolicies(
  agent: Agent,
  servers: PolicyAwareMcpServer[],
  catalog: AgentToolCatalogServer[],
): RunToolPolicySnapshot["policies"] {
  const permissionMode = effectiveAgentPermissionMode(agent);
  const saved = new Map(
    agentToolPolicyRepository
      .listForAgent(agent.id)
      .map((policy) => [policy.serverName, policy]),
  );
  return Object.fromEntries(
    servers.map((server) => {
      const serverCatalog = catalog.find(
        ({ serverName }) => serverName === server.name,
      );
      const explicit = saved.get(server.name);
      if (permissionMode !== "custom" || !explicit) {
        return [server.name, presetPolicy(agent, server, serverCatalog)];
      }
      const agentPolicy = {
        defaultMode: explicit.defaultMode,
        tools: explicit.tools,
      };
      return [
        server.name,
        server.approval
          ? combinePolicies(agentPolicy, server.approval)
          : agentPolicy,
      ];
    }),
  );
}

export function snapshotAgentToolPolicies(input: {
  runId: string;
  agent: Agent;
  servers: PolicyAwareMcpServer[];
  catalog?: AgentToolCatalogServer[];
  overrides?: Record<string, McpToolPolicy>;
}) {
  const policies = livePolicies(input.agent, input.servers, input.catalog ?? []);
  for (const [serverName, override] of Object.entries(input.overrides ?? {})) {
    if (policies[serverName]) {
      policies[serverName] = combinePolicies(policies[serverName], override);
    }
  }
  const captured = agentToolPolicyRepository.getOrCreateRunSnapshot({
    runId: input.runId,
    agentId: input.agent.id,
    policies,
  });
  const { snapshot } = captured;
  const servers = input.servers.flatMap((server) => {
    const policy = snapshot.policies[server.name];
    if (!policy && !captured.created) return [];
    return [
      {
        ...server,
        approval:
          policy ??
          presetPolicy(
            input.agent,
            server,
            input.catalog?.find(({ serverName }) => serverName === server.name),
          ),
      },
    ];
  });
  return { servers, snapshot };
}

export function filterToolsByRunPolicy(
  runId: string,
  serverName: string,
  tools: string[],
) {
  const snapshot = agentToolPolicyRepository.getRunSnapshot(runId);
  if (!snapshot) return tools;
  const policy = snapshot.policies[serverName];
  if (!policy) return [];
  return tools.filter((tool) => modeFor(policy, tool) !== "deny");
}
