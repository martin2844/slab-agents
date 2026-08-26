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
  enabled: boolean;
  status: string;
  permissions: Record<string, string[]>;
};

export type AgentDirectoryEmailAccess = {
  agentId: string;
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  sendPolicy: "disabled" | "approval_required" | "autonomous";
};

export type AgentDirectoryEntry = {
  name: string;
  slug: string;
  role: string;
  workDocsWrites: "autonomous" | "approval_required";
  integrations: string[];
  email: {
    read: boolean;
    draft: boolean;
    send: boolean;
    sendPolicy: AgentDirectoryEmailAccess["sendPolicy"];
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

const readablePolicy = (policy: string) =>
  policy.replaceAll("_", " ");

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

export function createWorkCoordinationContext(input: {
  agents: AgentDirectorySource[];
  integrations?: AgentDirectoryIntegration[];
  emailAccess?: AgentDirectoryEmailAccess[];
  emailConnected?: boolean;
}) {
  const integrations = input.integrations ?? [];
  const emailByAgent = new Map(
    (input.emailConnected === false ? [] : (input.emailAccess ?? [])).map(
      (access) => [access.agentId, access],
    ),
  );
  const entries: AgentDirectoryEntry[] = input.agents
    .filter((agent) => agent.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((agent) => {
      const email = emailByAgent.get(agent.id);
      return {
        name: compact(agent.name, 80),
        slug: compact(agent.slug, 80),
        role: compact(agent.role),
        workDocsWrites: agent.fullAccess
          ? "autonomous"
          : "approval_required",
        integrations: integrations
          .filter(
            (integration) =>
              integration.enabled &&
              integration.status === "connected" &&
              (integration.permissions[agent.id]?.length ?? 0) > 0,
          )
          .map(({ name }) => compact(name, 80))
          .filter((name, index, names) => names.indexOf(name) === index)
          .sort((left, right) => left.localeCompare(right)),
        email: email
          ? {
              read: email.readEnabled,
              draft: email.draftEnabled,
              send:
                email.sendEnabled && email.sendPolicy !== "disabled",
              sendPolicy: email.sendPolicy,
            }
          : null,
      };
    });
  const directory: AgentDirectory = {
    semantics: "snapshot_at_run_start",
    entries,
  };
  const directoryInstructions = [
    "Enabled agent directory (generated from the current control-plane configuration):",
    ...(entries.length
      ? entries.flatMap((entry) => {
          const capabilityLabels = [
            `Work + Docs (writes ${readablePolicy(entry.workDocsWrites)})`,
            emailCapabilityLabel(entry.email),
            ...entry.integrations,
          ].filter(Boolean);
          return [
            `- \`${entry.slug}\` — ${entry.name} — ${entry.role}`,
            `  Capabilities: ${capabilityLabels.join("; ")}`,
          ];
        })
      : ["- No enabled agents are currently registered."]),
  ].join("\n");
  const coordinationInstructions = [
    "Work coordination in this local control plane:",
    "Assigning a Work item to an enabled agent slug starts that agent automatically.",
    "When delegating to an agent, use an exact slug from the enabled agent directory. A role label such as `followups`, `sales`, or `support` is not an assignee slug unless it appears there. Never invent an agent slug.",
    "Do not claim that work was delegated to an agent when the assignee is not an exact enabled slug from the directory.",
    "Work comments can mention an agent by its exact slug (for example @coo) to request its input.",
    "Use Work items and comments—not direct agent messages—for delegation, execution, review, and operational decisions.",
    'Slab supports new, in_progress, and done natively. Represent review as in_progress + label "status:review", and blocked as in_progress + label "status:blocked". Remove those labels when leaving the semantic state.',
  ].join("\n");

  return {
    directory,
    directoryInstructions,
    coordinationInstructions,
    instructions: `${directoryInstructions}\n\n${coordinationInstructions}`,
  };
}
