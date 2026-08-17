import type { Issue, IssueStatus } from "./types";

export const WORK_STATUS_LABELS = {
  blocked: "status:blocked",
  review: "status:review",
} as const;

const semanticLabels = new Set<string>(Object.values(WORK_STATUS_LABELS));

export function semanticStatus(
  remoteStatus: "new" | "in_progress" | "done",
  labels: string[] = [],
): IssueStatus {
  if (remoteStatus === "done") return "done";
  if (labels.includes(WORK_STATUS_LABELS.blocked)) return "blocked";
  if (labels.includes(WORK_STATUS_LABELS.review)) return "review";
  return remoteStatus;
}

export function normalizeIssue(
  issue: Omit<Issue, "status"> & {
    status: "new" | "in_progress" | "done";
  },
): Issue {
  return {
    ...issue,
    status: semanticStatus(issue.status, issue.labels),
  };
}

export function remoteStatusUpdate(status: IssueStatus, labels: string[] = []) {
  const nextLabels = labels.filter((label) => !semanticLabels.has(label));
  if (status === "blocked" || status === "review") {
    nextLabels.push(WORK_STATUS_LABELS[status]);
    return { status: "in_progress" as const, labels: nextLabels };
  }
  return { status, labels: nextLabels };
}

export function mentionHandles(body: string) {
  return [
    ...new Set(
      Array.from(body.matchAll(/@([a-z0-9][\w-]*)/gi)).map((match) =>
        match[1].toLocaleLowerCase(),
      ),
    ),
  ];
}
