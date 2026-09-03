import { expandIntegrationToolGrants } from "@/lib/integrations/tool-access";

export type AgentDirectorySource = {
  id: string;
  name: string;
  slug: string;
  role: string;
  enabled: boolean;
  fullAccess: boolean;
};

export type AgentDirectoryIntegration = {
  name: string;
  serverName?: string;
  enabled: boolean;
  status: string;
  permissions: Record<string, string[]>;
  tools?: Array<{ key: string }>;
};

export type AgentDirectoryEmailAccess = {
  agentId: string;
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  sendPolicy: "disabled" | "approval_required" | "autonomous";
};

export type AgentDirectoryToolPolicy = {
  agentId: string;
  serverName: string;
  defaultMode: "approve" | "prompt" | "deny";
  tools: Record<string, "approve" | "prompt" | "deny">;
};

type EffectiveEmailSendPolicy =
  AgentDirectoryEmailAccess["sendPolicy"] | "custom_per_tool";

export type AgentDirectoryEntry = {
  name: string;
  slug: string;
  role: string;
  work: boolean;
  docs: boolean;
  workDocsWrites:
    "autonomous" | "approval_required" | "custom_per_tool" | "no_access";
  integrations: string[];
  email: {
    read: boolean;
    draft: boolean;
    send: boolean;
    sendPolicy: EffectiveEmailSendPolicy;
  } | null;
};

export type AgentDirectory = {
  semantics: "snapshot_at_run_start";
  entries: AgentDirectoryEntry[];
};

const compact = (value: string, maxLength = 160) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const readablePolicy = (policy: string) => policy.replaceAll("_", " ");

function emailCapabilityLabel(email: AgentDirectoryEntry["email"]) {
  if (!email) return null;
  const grants = [
    email.read ? "read" : null,
    email.draft ? "draft" : null,
    email.send ? "send" : null,
  ].filter(Boolean);
  if (!grants.length) return null;
  const policy = email.send ? `; ${readablePolicy(email.sendPolicy)}` : "";
  return `Email (${grants.join(", ")}${policy})`;
}

function toolMode(policy: AgentDirectoryToolPolicy | undefined, tool: string) {
  return policy?.tools[tool] ?? policy?.defaultMode ?? "approve";
}

export function createWorkCoordinationContext(input: {
  agents: AgentDirectorySource[];
  integrations?: AgentDirectoryIntegration[];
  emailAccess?: AgentDirectoryEmailAccess[];
  toolPolicies?: AgentDirectoryToolPolicy[];
  coreTools?: Record<
    "work" | "docs",
    Array<{ name: string; readOnly: boolean }>
  >;
  currentAgentId?: string;
  currentRunToolsByServer?: Record<string, string[]>;
  currentRunWorkTools?: string[];
  emailConnected?: boolean;
}) {
  const integrations = input.integrations ?? [];
  const policyByAgentAndServer = new Map(
    (input.toolPolicies ?? []).map((policy) => [
      `${policy.agentId}:${policy.serverName}`,
      policy,
    ]),
  );
  const emailByAgent = new Map(
    (input.emailConnected === false ? [] : (input.emailAccess ?? [])).map(
      (access) => [access.agentId, access],
    ),
  );
  const entries: AgentDirectoryEntry[] = input.agents
    .filter((agent) => agent.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((agent) => {
      const runScopedTools =
        agent.id === input.currentAgentId
          ? (input.currentRunToolsByServer ?? {})
          : undefined;
      const configuredEmail = emailByAgent.get(agent.id);
      const emailPolicy = policyByAgentAndServer.get(`${agent.id}:email`);
      const runEmailTools = runScopedTools
        ? new Set(runScopedTools.email ?? [])
        : undefined;
      const emailToolAvailable = (tool: string) =>
        runEmailTools
          ? runEmailTools.has(tool)
          : toolMode(emailPolicy, tool) !== "deny";
      const sendModes =
        configuredEmail?.sendEnabled &&
        configuredEmail.sendPolicy !== "disabled"
          ? [
              "email_send",
              ...(configuredEmail.readEnabled ? ["email_reply"] : []),
            ]
              .filter(emailToolAvailable)
              .map((tool) => toolMode(emailPolicy, tool))
              .map((mode) =>
                configuredEmail.sendPolicy === "approval_required"
                  ? "prompt"
                  : mode,
              )
          : [];
      const effectiveSendPolicy: EffectiveEmailSendPolicy = !sendModes.length
        ? "disabled"
        : sendModes.every((mode) => mode === "approve")
          ? "autonomous"
          : sendModes.every((mode) => mode === "prompt")
            ? "approval_required"
            : "custom_per_tool";
      const email = configuredEmail
        ? {
            ...configuredEmail,
            readEnabled:
              configuredEmail.readEnabled &&
              ["email_search", "email_get_message", "email_list_threads"].some(
                emailToolAvailable,
              ),
            draftEnabled:
              configuredEmail.draftEnabled &&
              emailToolAvailable("email_create_draft"),
            sendEnabled:
              configuredEmail.sendEnabled && effectiveSendPolicy !== "disabled",
            sendPolicy: effectiveSendPolicy,
          }
        : undefined;
      const workPolicy = policyByAgentAndServer.get(`${agent.id}:work`);
      const docsPolicy = policyByAgentAndServer.get(`${agent.id}:docs`);
      const serverAvailable = (
        policy: AgentDirectoryToolPolicy | undefined,
        serverName: "work" | "docs",
      ) => {
        if (runScopedTools) {
          return (runScopedTools[serverName]?.length ?? 0) > 0;
        }
        const tools = input.coreTools?.[serverName];
        if (!policy) return true;
        if (tools) {
          return tools.some(({ name }) => toolMode(policy, name) !== "deny");
        }
        return (
          policy.defaultMode !== "deny" ||
          Object.values(policy.tools).some((mode) => mode !== "deny")
        );
      };
      const work = serverAvailable(workPolicy, "work");
      const docs = serverAvailable(docsPolicy, "docs");
      const writeModes = input.coreTools
        ? (["work", "docs"] as const).flatMap((serverName) => {
            if (
              (serverName === "work" && !work) ||
              (serverName === "docs" && !docs)
            ) {
              return [];
            }
            const policy = serverName === "work" ? workPolicy : docsPolicy;
            return input
              .coreTools![serverName].filter(({ readOnly }) => !readOnly)
              .map(({ name }) =>
                policy
                  ? toolMode(policy, name)
                  : agent.fullAccess
                    ? "approve"
                    : "prompt",
              );
          })
        : [];
      const workDocsWrites = writeModes.length
        ? writeModes.every((mode) => mode === "deny")
          ? "no_access"
          : writeModes.every((mode) => mode === "approve")
            ? "autonomous"
            : writeModes.every((mode) => mode === "prompt")
              ? "approval_required"
              : "custom_per_tool"
        : workPolicy || docsPolicy
          ? "custom_per_tool"
          : agent.fullAccess
            ? "autonomous"
            : "approval_required";
      return {
        name: compact(agent.name, 80),
        slug: compact(agent.slug, 80),
        role: compact(agent.role),
        work,
        docs,
        workDocsWrites,
        integrations: integrations
          .filter((integration) => {
            if (!integration.enabled || integration.status !== "connected") {
              return false;
            }
            const grants = runScopedTools
              ? integration.serverName
                ? (runScopedTools[integration.serverName] ?? [])
                : []
              : (integration.permissions[agent.id] ?? []);
            const assignedTools = runScopedTools
              ? grants
              : expandIntegrationToolGrants(
                  grants,
                  integration.tools?.map((tool) => tool.key) ?? grants,
                );
            if (!assignedTools.length) return false;
            if (runScopedTools) return true;
            return assignedTools.some(
              (tool) =>
                toolMode(
                  integration.serverName
                    ? policyByAgentAndServer.get(
                        `${agent.id}:${integration.serverName}`,
                      )
                    : undefined,
                  tool,
                ) !== "deny",
            );
          })
          .map(({ name }) => compact(name, 80))
          .filter((name, index, names) => names.indexOf(name) === index)
          .sort((left, right) => left.localeCompare(right)),
        email:
          email &&
          (email.readEnabled || email.draftEnabled || email.sendEnabled)
            ? {
                read: email.readEnabled,
                draft: email.draftEnabled,
                send: email.sendEnabled && email.sendPolicy !== "disabled",
                sendPolicy: email.sendPolicy,
              }
            : null,
      };
    });
  const directory: AgentDirectory = {
    semantics: "snapshot_at_run_start",
    entries,
  };
  const currentIntegrationTools = Object.entries(
    input.currentRunToolsByServer ?? {},
  ).flatMap(([serverName, tools]) => {
    const integration = integrations.find(
      (candidate) => candidate.serverName === serverName,
    );
    if (!integration || tools.length === 0) return [];
    return [
      `- ${compact(integration.name, 80)}: ${tools.map((tool) => `\`${tool}\``).join(", ")}`,
    ];
  });
  const directoryInstructions = [
    "Enabled agent directory (generated from the current control-plane configuration):",
    ...(entries.length
      ? entries.flatMap((entry) => {
          const capabilityLabels = [
            ...([entry.work ? "Work" : null, entry.docs ? "Docs" : null].filter(
              Boolean,
            ).length
              ? [
                  `${[entry.work ? "Work" : null, entry.docs ? "Docs" : null]
                    .filter(Boolean)
                    .join(
                      " + ",
                    )} (writes ${readablePolicy(entry.workDocsWrites)})`,
                ]
              : []),
            emailCapabilityLabel(entry.email),
            ...entry.integrations,
          ].filter(Boolean);
          return [
            `- \`${entry.slug}\` — ${entry.name} — ${entry.role}`,
            `  Capabilities: ${capabilityLabels.length ? capabilityLabels.join("; ") : "No granted tools"}`,
          ];
        })
      : ["- No enabled agents are currently registered."]),
    ...(input.currentRunToolsByServer === undefined
      ? []
      : [
          "",
          "Current agent integration tools in this run (authoritative snapshot):",
          ...(currentIntegrationTools.length
            ? currentIntegrationTools
            : ["- None"]),
          "Treat listed tools as available for this run. Capability changes made later apply to the next run.",
        ]),
  ].join("\n");
  const currentRunWorkTools = input.currentRunWorkTools;
  const coordinationInstructions = (
    currentRunWorkTools === undefined
      ? [
          "Work coordination in this local control plane:",
          "Assigning a Work item to an enabled agent slug starts that agent automatically.",
          "When delegating to an agent, use an exact slug from the enabled agent directory. A role label such as `followups`, `sales`, or `support` is not an assignee slug unless it appears there. Never invent an agent slug.",
          "Do not claim that work was delegated to an agent when the assignee is not an exact enabled slug from the directory.",
          "Work comments can mention an agent by its exact slug (for example @coo) to request its input.",
          "Use Work items and comments—not direct agent messages—for delegation, execution, review, and operational decisions.",
          'Slab supports new, in_progress, and done natively. Represent review as in_progress + label "status:review", and blocked as in_progress + label "status:blocked". Remove those labels when leaving the semantic state.',
        ]
      : currentRunWorkTools.length
        ? [
            "Work coordination in this local control plane:",
            `Work tools available in this run: ${currentRunWorkTools.join(", ")}.`,
            ...(currentRunWorkTools.includes("assign_issue")
              ? [
                  "Assigning a Work item to an enabled agent slug starts that agent automatically.",
                  "When delegating to an agent, use an exact slug from the enabled agent directory. Never invent an agent slug.",
                ]
              : ["This run cannot assign Work items."]),
            "Do not claim that work was delegated unless an available tool confirmed it.",
            ...(currentRunWorkTools.includes("add_comment")
              ? [
                  "Work comments can mention an agent by its exact slug (for example @coo) to request its input.",
                ]
              : []),
            ...(currentRunWorkTools.includes("set_issue_status") &&
            currentRunWorkTools.includes("set_issue_labels")
              ? [
                  'Slab supports new, in_progress, and done natively. Represent review as in_progress + label "status:review", and blocked as in_progress + label "status:blocked". Remove those labels when leaving the semantic state.',
                ]
              : []),
          ]
        : [
            "Work coordination is unavailable in this run because no Work tools are granted.",
            "Do not claim to read, assign, comment on, or change Work items.",
          ]
  ).join("\n");

  return {
    directory,
    directoryInstructions,
    coordinationInstructions,
    instructions: `${directoryInstructions}\n\n${coordinationInstructions}`,
  };
}
