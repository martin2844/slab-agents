import "server-only";

import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";
import type { Agent, RunToolPolicySnapshot, ToolPolicyMode } from "@/lib/types";

export type McpToolPolicy = {
  defaultMode: ToolPolicyMode;
  tools: Record<string, ToolPolicyMode>;
};

export type PolicyAwareMcpServer = {
  name: string;
  url: string;
  credentials?: { bearerToken: string };
  approval?: McpToolPolicy;
};

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

function legacyPolicy(
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

function livePolicies(
  agent: Agent,
  servers: PolicyAwareMcpServer[],
): RunToolPolicySnapshot["policies"] {
  const saved = new Map(
    agentToolPolicyRepository
      .listForAgent(agent.id)
      .map((policy) => [policy.serverName, policy]),
  );
  return Object.fromEntries(
    servers.map((server) => {
      const explicit = saved.get(server.name);
      if (!explicit) return [server.name, legacyPolicy(agent, server)];
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
}) {
  const captured = agentToolPolicyRepository.getOrCreateRunSnapshot({
    runId: input.runId,
    agentId: input.agent.id,
    policies: livePolicies(input.agent, input.servers),
  });
  const { snapshot } = captured;
  const servers = input.servers.flatMap((server) => {
    const policy = snapshot.policies[server.name];
    if (!policy && !captured.created) return [];
    return [
      {
        ...server,
        approval: policy ?? legacyPolicy(input.agent, server),
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
