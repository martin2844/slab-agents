import "server-only";

import type {
  Agent,
  AgentEmailAccess,
  AgentToolCatalogServer,
  AgentToolCatalogTool,
  Integration,
  ToolPolicyMode,
} from "@/lib/types";

type ToolDefinition = Pick<
  AgentToolCatalogTool,
  "name" | "label" | "description" | "readOnly"
>;

function defineTool(
  name: string,
  label: string,
  description: string,
  readOnly: boolean,
): ToolDefinition {
  return { name, label, description, readOnly };
}

const workTools: ToolDefinition[] = [
  defineTool(
    "list_projects",
    "List projects",
    "See the workspace project directory.",
    true,
  ),
  defineTool("get_project", "Get project", "Read one project's details.", true),
  defineTool(
    "list_issues",
    "List work items",
    "Browse filtered work items.",
    true,
  ),
  defineTool(
    "get_issue",
    "Get work item",
    "Read one work item and its current version.",
    true,
  ),
  defineTool(
    "search_issues",
    "Search work",
    "Search work item titles and descriptions.",
    true,
  ),
  defineTool(
    "get_blocked_issues",
    "Inspect blocked work",
    "Find work blocked by unfinished dependencies.",
    true,
  ),
  defineTool(
    "list_comments",
    "List comments",
    "Read the discussion on a work item.",
    true,
  ),
  defineTool(
    "list_links",
    "List relationships",
    "Read dependencies and related work.",
    true,
  ),
  defineTool(
    "get_issue_history",
    "Read change history",
    "Audit changes to a work item.",
    true,
  ),
  defineTool(
    "create_project",
    "Create project",
    "Create a new project and key.",
    false,
  ),
  defineTool(
    "update_project",
    "Edit project",
    "Change a project's name or description.",
    false,
  ),
  defineTool(
    "create_issue",
    "Create work item",
    "Add a task, bug, story, or epic.",
    false,
  ),
  defineTool(
    "update_issue",
    "Edit any work field",
    "Use the broad optimistic-concurrency update.",
    false,
  ),
  defineTool(
    "assign_issue",
    "Assign work",
    "Assign or unassign a work item.",
    false,
  ),
  defineTool(
    "set_issue_status",
    "Change status",
    "Move a work item through its workflow.",
    false,
  ),
  defineTool(
    "set_issue_priority",
    "Change priority",
    "Set operational priority.",
    false,
  ),
  defineTool(
    "edit_issue_content",
    "Edit work content",
    "Change type, title, or description.",
    false,
  ),
  defineTool(
    "set_issue_labels",
    "Set labels",
    "Replace a work item's label set.",
    false,
  ),
  defineTool(
    "delete_issue",
    "Delete work item",
    "Permanently delete one work item.",
    false,
  ),
  defineTool("add_comment", "Add comment", "Post a Markdown comment.", false),
  defineTool(
    "link_issues",
    "Link work items",
    "Create a dependency or relationship.",
    false,
  ),
  defineTool(
    "unlink_issues",
    "Unlink work items",
    "Remove an existing relationship.",
    false,
  ),
];

const docsTools: ToolDefinition[] = [
  defineTool(
    "list_docs",
    "List documents",
    "Browse document metadata and hierarchy.",
    true,
  ),
  defineTool(
    "search_docs",
    "Search documents",
    "Search titles, Markdown bodies, and tags.",
    true,
  ),
  defineTool("get_doc", "Read document", "Read one complete document.", true),
  defineTool(
    "list_doc_revisions",
    "List revisions",
    "Inspect a document's revision history.",
    true,
  ),
  defineTool(
    "get_doc_revision",
    "Read revision",
    "Read one historical revision.",
    true,
  ),
  defineTool(
    "create_doc",
    "Create document",
    "Create a Markdown document.",
    false,
  ),
  defineTool(
    "update_doc",
    "Edit document",
    "Update content, metadata, or hierarchy.",
    false,
  ),
  defineTool(
    "archive_doc",
    "Archive document",
    "Soft-delete a document while retaining history.",
    false,
  ),
];

export function coreToolDefinitions() {
  return {
    work: workTools.map((tool) => ({ ...tool })),
    docs: docsTools.map((tool) => ({ ...tool })),
  };
}

function coreTool(
  tool: ToolDefinition,
  fullAccess: boolean,
): AgentToolCatalogTool {
  return {
    ...tool,
    legacyMode: tool.readOnly || fullAccess ? "approve" : "prompt",
    maximumMode: "approve",
  };
}

function emailTools(access: AgentEmailAccess | null): AgentToolCatalogTool[] {
  if (!access) return [];
  const tools: Array<
    ToolDefinition & { mode: ToolPolicyMode; maximumMode?: "prompt" }
  > = [
    {
      name: "email_list_accounts",
      label: "List email accounts",
      description: "See the mailbox identities assigned to this agent.",
      readOnly: true,
      mode: "approve",
    },
    ...(access.readEnabled
      ? [
          {
            name: "email_search",
            label: "Search email",
            description: "Search assigned mailboxes with bounded filters.",
            readOnly: true,
            mode: "approve" as const,
          },
          {
            name: "email_get_message",
            label: "Read message",
            description: "Read one message from an assigned mailbox.",
            readOnly: true,
            mode: "approve" as const,
          },
          {
            name: "email_list_threads",
            label: "List email threads",
            description: "Read bounded conversation summaries.",
            readOnly: true,
            mode: "approve" as const,
          },
        ]
      : []),
    ...(access.draftEnabled
      ? [
          {
            name: "email_create_draft",
            label: "Create draft",
            description: "Prepare email without sending it.",
            readOnly: false,
            mode: "approve" as const,
          },
        ]
      : []),
    ...(access.sendEnabled && access.sendPolicy !== "disabled"
      ? [
          {
            name: "email_send",
            label: "Send email",
            description: "Send from a verified assigned identity.",
            readOnly: false,
            mode:
              access.sendPolicy === "approval_required"
                ? ("prompt" as const)
                : ("approve" as const),
            maximumMode:
              access.sendPolicy === "approval_required"
                ? ("prompt" as const)
                : undefined,
          },
          ...(access.readEnabled
            ? [
                {
                  name: "email_reply",
                  label: "Reply to email",
                  description: "Reply to a verified original sender.",
                  readOnly: false,
                  mode:
                    access.sendPolicy === "approval_required"
                      ? ("prompt" as const)
                      : ("approve" as const),
                  maximumMode:
                    access.sendPolicy === "approval_required"
                      ? ("prompt" as const)
                      : undefined,
                },
              ]
            : []),
        ]
      : []),
  ];
  return tools.map(({ mode, maximumMode, ...tool }) => ({
    ...tool,
    legacyMode: mode,
    maximumMode: maximumMode ?? "approve",
  }));
}

export function integrationServerName(integration: Integration) {
  if (integration.provider === "posthog") return "work_posthog";
  if (integration.provider.startsWith("calendar_")) {
    return `calendar_${integration.slug}`;
  }
  return `${integration.provider}_${integration.slug}`;
}

function integrationToolMode(
  agent: Agent,
  integration: Integration,
  readOnly: boolean,
): Pick<AgentToolCatalogTool, "legacyMode" | "maximumMode"> {
  if (integration.provider === "custom_http") {
    return { legacyMode: "approve", maximumMode: "approve" };
  }
  if (integration.provider.startsWith("calendar_")) {
    const approvalRequired =
      !readOnly && integration.writePolicy === "approval_required";
    return {
      legacyMode: approvalRequired ? "prompt" : "approve",
      maximumMode: approvalRequired ? "prompt" : "approve",
    };
  }
  return {
    legacyMode: agent.fullAccess ? "approve" : "prompt",
    maximumMode: "approve",
  };
}

export function buildAgentToolCatalog(input: {
  agent: Agent;
  integrations: Integration[];
  emailAccess: AgentEmailAccess | null;
}): AgentToolCatalogServer[] {
  const result: AgentToolCatalogServer[] = [
    {
      serverName: "work",
      label: "Work",
      description: "Projects, work items, assignments, and coordination.",
      integrationId: null,
      tools: workTools.map((tool) => coreTool(tool, input.agent.fullAccess)),
    },
    {
      serverName: "docs",
      label: "Docs",
      description: "Workspace knowledge, revisions, and publishing.",
      integrationId: null,
      tools: docsTools.map((tool) => coreTool(tool, input.agent.fullAccess)),
    },
  ];
  const email = emailTools(input.emailAccess);
  if (email.length) {
    result.push({
      serverName: "email",
      label: "Email",
      description: "Assigned mailboxes and verified sender identities.",
      integrationId: null,
      tools: email,
    });
  }
  for (const integration of input.integrations) {
    const availableTools =
      integration.provider.startsWith("calendar_") &&
      integration.writePolicy === "disabled"
        ? integration.tools.filter((tool) => tool.readOnly)
        : integration.tools;
    result.push({
      serverName: integrationServerName(integration),
      label: integration.name,
      description: `${integration.provider.replaceAll("_", " ")} · ${integration.status.replaceAll("_", " ")}`,
      integrationId: integration.id,
      tools: availableTools.map((tool) => ({
        name: tool.key,
        label: tool.name,
        description: tool.description,
        readOnly: tool.readOnly,
        ...integrationToolMode(input.agent, integration, tool.readOnly),
      })),
    });
  }
  return result;
}
