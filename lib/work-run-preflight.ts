import type { RunTrigger } from "@/lib/run-execution";
import type { Agent, Issue } from "@/lib/types";

export type WorkRunTrigger = Extract<
  RunTrigger,
  "assignment" | "resumed" | "review_requested" | "blocked" | "mention"
>;

type TargetAgent = Pick<Agent, "id" | "name" | "slug">;

export type WorkRunPreflightResult = {
  required: true;
  valid: boolean;
  reason: "current_condition_satisfied" | "stale_trigger";
  trigger: WorkRunTrigger;
  issueKey: string | null;
  expected: Record<string, unknown>;
  observed: Record<string, unknown>;
};

const WORK_RUN_TRIGGERS = new Set<RunTrigger>([
  "assignment",
  "resumed",
  "review_requested",
  "blocked",
  "mention",
]);

export function requiresWorkRunPreflight(
  trigger: RunTrigger,
): trigger is WorkRunTrigger {
  return WORK_RUN_TRIGGERS.has(trigger);
}

function assignedTo(issue: Issue, agent: TargetAgent) {
  const assignee = issue.assignee?.trim().replace(/^@/, "").toLowerCase();
  return [agent.id, agent.slug, agent.name].some(
    (identity) => identity.trim().replace(/^@/, "").toLowerCase() === assignee,
  );
}

export function expectedWorkRunCondition(
  trigger: WorkRunTrigger,
  targetAgent: TargetAgent,
) {
  switch (trigger) {
    case "assignment":
      return { assignee: targetAgent.slug, actionableStatus: true };
    case "resumed":
      return { assignee: targetAgent.slug, status: "in_progress" };
    case "review_requested":
      return { review: true, reviewerIsNotAssignee: true };
    case "blocked":
      return { blocked: true };
    case "mention":
      return { issueExists: true, eventBased: true };
  }
}

export function evaluateWorkRunPreflight(input: {
  trigger: WorkRunTrigger;
  targetAgent: TargetAgent;
  issue: Issue | null;
}): WorkRunPreflightResult {
  const { trigger, targetAgent, issue } = input;
  const expected = expectedWorkRunCondition(trigger, targetAgent);
  if (!issue) {
    return {
      required: true,
      valid: false,
      reason: "stale_trigger",
      trigger,
      issueKey: null,
      expected,
      observed: { exists: false },
    };
  }

  const isAssignedTarget = assignedTo(issue, targetAgent);
  const blocked = issue.status === "blocked";
  const review = issue.status === "review";
  const observed = {
    exists: true,
    status: issue.status,
    blocked,
    assignee: issue.assignee ?? null,
    version: issue.version,
  };
  let valid: boolean;

  switch (trigger) {
    case "assignment":
      valid =
        isAssignedTarget &&
        (issue.status === "new" || issue.status === "in_progress");
      break;
    case "resumed":
      valid = isAssignedTarget && issue.status === "in_progress";
      break;
    case "review_requested":
      valid = review && !isAssignedTarget;
      break;
    case "blocked":
      valid = blocked && !isAssignedTarget;
      break;
    case "mention":
      // Mentions represent a durable comment event. State changes do not
      // invalidate them; persistent event idempotency prevents duplicates.
      valid = true;
      break;
  }

  return {
    required: true,
    valid,
    reason: valid ? "current_condition_satisfied" : "stale_trigger",
    trigger,
    issueKey: issue.key,
    expected,
    observed,
  };
}
