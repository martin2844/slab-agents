import "server-only";

import { callMcpTool, testMcp } from "@/lib/mcp/client";
import { getSetting } from "@/lib/settings";
import type { Comment, Issue, Project } from "@/lib/types";

function connection() {
  return {
    url: getSetting("work_mcp_url"),
    apiKey: getSetting("work_api_key"),
  };
}

export const WorkClient = {
  listProjects: () => callMcpTool<Project[]>(connection(), "list_projects"),
  listIssues: async (projectKey: string) => {
    const result = await callMcpTool<
      { issues?: Issue[]; data?: Issue[] } | Issue[]
    >(connection(), "list_issues", {
      project_key: projectKey,
      limit: 100,
      offset: 0,
    });
    if (Array.isArray(result)) return result;
    return result.issues ?? result.data ?? [];
  },
  getIssue: (key: string) =>
    callMcpTool<Issue>(connection(), "get_issue", { key }),
  createIssue: (input: Record<string, unknown>) =>
    callMcpTool<Issue>(connection(), "create_issue", input),
  updateIssue: (key: string, input: Record<string, unknown>) =>
    callMcpTool<Issue>(connection(), "update_issue", { key, ...input }),
  listComments: (key: string) =>
    callMcpTool<Comment[]>(connection(), "list_comments", { issue_key: key }),
  addComment: (key: string, author: string, body: string) =>
    callMcpTool<Comment>(connection(), "add_comment", {
      issue_key: key,
      author,
      body,
    }),
  listLinks: (key: string) =>
    callMcpTool<Record<string, unknown>>(connection(), "list_links", {
      issue_key: key,
    }),
  getBlockedIssues: () =>
    callMcpTool<Issue[]>(connection(), "get_blocked_issues"),
  test: () => testMcp(connection()),
};
