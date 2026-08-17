import type { RunEvent, RunStatus } from "@/lib/types";

export type RunProgressItem = {
  id: string;
  label: string;
  command: string;
  status: "active" | "done" | "failed";
};

export type RunProgress = {
  headline: string;
  detail: string;
  command: string;
  items: RunProgressItem[];
};

const TOOL_LABELS: Record<string, [string, string]> = {
  list_projects: ["Listing Work projects", "Listed Work projects"],
  get_project: ["Reading project context", "Read project context"],
  list_issues: ["Reviewing open work", "Reviewed open work"],
  get_issue: ["Reading issue details", "Read issue details"],
  search_issues: ["Searching Work", "Searched Work"],
  list_comments: ["Reading issue comments", "Read issue comments"],
  list_links: ["Checking issue dependencies", "Checked issue dependencies"],
  get_blocked_issues: ["Checking blocked work", "Checked blocked work"],
  get_issue_history: ["Reading issue history", "Read issue history"],
  create_project: ["Creating a Work project", "Created a Work project"],
  update_project: ["Updating a Work project", "Updated a Work project"],
  create_issue: ["Creating a Work item", "Created a Work item"],
  update_issue: ["Updating a Work item", "Updated a Work item"],
  delete_issue: ["Deleting a Work item", "Deleted a Work item"],
  add_comment: ["Adding a Work comment", "Added a Work comment"],
  link_issues: ["Linking Work items", "Linked Work items"],
  unlink_issues: ["Removing a Work link", "Removed a Work link"],
  list_docs: ["Browsing company docs", "Browsed company docs"],
  search_docs: ["Searching company docs", "Searched company docs"],
  get_doc: ["Reading company documentation", "Read company documentation"],
  list_doc_revisions: ["Checking document revisions", "Checked document revisions"],
  get_doc_revision: ["Reading a document revision", "Read a document revision"],
  create_doc: ["Creating company documentation", "Created company documentation"],
  update_doc: ["Updating company documentation", "Updated company documentation"],
  archive_doc: ["Archiving company documentation", "Archived company documentation"],
  list_mcp_resources: ["Checking available resources", "Checked available resources"],
  shell: ["Preparing the agent runtime", "Prepared the agent runtime"],
};

function toolKey(payload: Record<string, unknown>) {
  const name = typeof payload.name === "string" ? payload.name : "tool";
  return name.split(".").at(-1) ?? name;
}

function toolLabel(payload: Record<string, unknown>, completed: boolean) {
  const key = toolKey(payload);
  const known = TOOL_LABELS[key];
  if (known) return known[completed ? 1 : 0];
  const readable = key.replaceAll("_", " ");
  return completed ? `Finished ${readable}` : `Using ${readable}`;
}

function toolCommand(payload: Record<string, unknown>) {
  const name = typeof payload.name === "string" ? payload.name : "tool";
  const kind = payload.kind;
  return kind === "mcpToolCall" || name.includes(".")
    ? `mcp ${name}`
    : `runtime ${name}`;
}

function toolItems(events: RunEvent[]): RunProgressItem[] {
  const items = new Map<string, RunProgressItem>();
  for (const event of events) {
    if (event.type !== "tool_started" && event.type !== "tool_completed") continue;
    const toolId = String(event.payload.toolId ?? event.id);
    const completed = event.type === "tool_completed";
    const failed = completed && event.payload.status === "failed";
    items.delete(toolId);
    items.set(toolId, {
      id: toolId,
      label: toolLabel(event.payload, completed),
      command: toolCommand(event.payload),
      status: failed ? "failed" : completed ? "done" : "active",
    });
  }
  return [...items.values()].slice(-4);
}

export function buildRunProgress(
  events: RunEvent[],
  status: RunStatus | null,
): RunProgress {
  const items = toolItems(events);
  const active = [...items].reverse().find((item) => item.status === "active");
  const command = active?.command ?? items.at(-1)?.command ?? "runtime planning";
  const lastEvent = events.at(-1)?.type;

  if (status === "waiting_approval") {
    return {
      headline: "Waiting for your approval",
      detail: "The run will continue as soon as you approve or deny the action below.",
      command: "approval waiting",
      items,
    };
  }
  if (status === "queued") {
    return {
      headline: "Queued for Runner",
      detail: "The agent will start as soon as the local runtime is available.",
      command: "runner queued",
      items,
    };
  }
  if (status === "failed") {
    return {
      headline: "The run stopped",
      detail: "Open the run details for the complete error and event history.",
      command,
      items,
    };
  }
  if (active) {
    return {
      headline: active.label,
      detail: "Live activity from Runner · updates automatically",
      command,
      items,
    };
  }
  if (lastEvent === "thread_created" || lastEvent === "runner_run_started") {
    return {
      headline: "Agent session ready",
      detail: "The agent is deciding which context and tools it needs.",
      command: "runtime planning",
      items,
    };
  }
  if (items.length > 0) {
    return {
      headline: "Analyzing what it found",
      detail: "The agent is working toward a final response.",
      command,
      items,
    };
  }
  return {
    headline: "Starting the agent",
    detail: "Connecting to Runner and preparing the conversation.",
    command: "runner connect",
    items,
  };
}
