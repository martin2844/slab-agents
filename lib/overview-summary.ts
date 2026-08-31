import type { Agent, Issue, OverviewData, Run } from "@/lib/types";

type WorkOverview = OverviewData["work"];

export function summarizeAgentOverview(
  agents: readonly Agent[],
  runs: readonly Run[],
): OverviewData["agents"] {
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const runningAgentIds = new Set(
    runs.filter((run) => run.status === "running").map((run) => run.agentId),
  );
  const engagedAgentIds = new Set(
    runs
      .filter((run) =>
        ["running", "queued", "waiting_approval"].includes(run.status),
      )
      .map((run) => run.agentId),
  );

  return {
    total: agents.length,
    running: runningAgentIds.size,
    queued: runs.filter((run) => run.status === "queued").length,
    waitingApproval: runs.filter((run) => run.status === "waiting_approval")
      .length,
    idle: enabledAgents.filter((agent) => !engagedAgentIds.has(agent.id))
      .length,
  };
}

export function unavailableWorkOverview(): WorkOverview {
  return {
    open: 0,
    backlog: 0,
    assigned: 0,
    inProgress: 0,
    blocked: 0,
    review: 0,
    connected: false,
  };
}

export function summarizeWorkOverview(
  issues: readonly Issue[],
  relationshipBlockedIssues: readonly Pick<Issue, "key">[],
): WorkOverview {
  const relationshipBlockedKeys = new Set(
    relationshipBlockedIssues.map((issue) => issue.key),
  );
  const activeIssues = issues.filter((issue) => issue.status !== "done");
  const isBlocked = (issue: Issue) =>
    issue.status === "blocked" || relationshipBlockedKeys.has(issue.key);

  return {
    open: activeIssues.length,
    backlog: activeIssues.filter(
      (issue) => issue.status === "new" && !issue.assignee && !isBlocked(issue),
    ).length,
    assigned: activeIssues.filter(
      (issue) =>
        issue.status === "new" && Boolean(issue.assignee) && !isBlocked(issue),
    ).length,
    inProgress: activeIssues.filter(
      (issue) => issue.status === "in_progress" && !isBlocked(issue),
    ).length,
    blocked: activeIssues.filter(isBlocked).length,
    review: activeIssues.filter(
      (issue) => issue.status === "review" && !isBlocked(issue),
    ).length,
    connected: true,
  };
}
