import "server-only";

import { callMcpTool, testMcp } from "@/lib/mcp/client";
import { getSetting } from "@/lib/settings";
import type { Comment, Issue, Project } from "@/lib/types";
import { normalizeIssue, remoteStatusUpdate } from "@/lib/work-status";

type RemoteIssue = Omit<Issue, "status"> & {
  status: "new" | "in_progress" | "done";
};

type IssueMutationResult = Pick<RemoteIssue, "id" | "key" | "status"> & {
  version: number;
  updated_at: string;
  changed_fields: string[];
};

type CommentMutationResult = Omit<Comment, "body">;

function connection() {
  return {
    url: getSetting("work_mcp_url"),
    apiKey: getSetting("work_api_key"),
  };
}

export const WorkClient = {
  listProjects: () => callMcpTool<Project[]>(connection(), "list_projects"),
  createProject: (input: {
    key: string;
    name: string;
    description?: string;
  }) => callMcpTool<Project>(connection(), "create_project", input),
  listIssues: async (projectKey: string) => {
    const result = await callMcpTool<
      { issues?: RemoteIssue[]; data?: RemoteIssue[] } | RemoteIssue[]
    >(connection(), "list_issues", {
      project_key: projectKey,
      limit: 100,
      offset: 0,
    });
    const issues = Array.isArray(result)
      ? result
      : (result.issues ?? result.data ?? []);
    return issues.map(normalizeIssue);
  },
  getIssue: async (key: string) =>
    normalizeIssue(
      await callMcpTool<RemoteIssue>(connection(), "get_issue", { key }),
    ),
  createIssue: async (input: Record<string, unknown>) => {
    const created = await callMcpTool<IssueMutationResult>(
      connection(),
      "create_issue",
      input,
    );
    return WorkClient.getIssue(created.key);
  },
  updateIssue: async (key: string, input: Record<string, unknown>) => {
    const requestedStatus = input.status as Issue["status"] | undefined;
    let nextInput = input;
    if (requestedStatus) {
      const current = await callMcpTool<RemoteIssue>(
        connection(),
        "get_issue",
        { key },
      );
      nextInput = {
        ...input,
        ...remoteStatusUpdate(
          requestedStatus,
          Array.isArray(input.labels)
            ? (input.labels as string[])
            : current.labels,
        ),
      };
    }
    const updated = await callMcpTool<IssueMutationResult>(
      connection(),
      "update_issue",
      { key, ...nextInput },
    );
    return WorkClient.getIssue(updated.key);
  },
  listComments: (key: string) =>
    callMcpTool<Comment[]>(connection(), "list_comments", { issue_key: key }),
  addComment: async (key: string, author: string, body: string) => {
    const comment = await callMcpTool<CommentMutationResult>(
      connection(),
      "add_comment",
      {
      issue_key: key,
      author,
      body,
      },
    );
    return { ...comment, body };
  },
  listLinks: (key: string) =>
    callMcpTool<Record<string, unknown>>(connection(), "list_links", {
      issue_key: key,
    }),
  getBlockedIssues: async () =>
    (await callMcpTool<RemoteIssue[]>(connection(), "get_blocked_issues")).map(
      normalizeIssue,
    ),
  test: () => testMcp(connection()),
};
