import "server-only";

import { WorkClient } from "@/lib/mcp/work-client";
import { repository } from "@/lib/repository";
import type { Agent, Run } from "@/lib/types";
import {
  evaluateWorkRunPreflight,
  expectedWorkRunCondition,
  requiresWorkRunPreflight,
  type WorkRunPreflightResult,
} from "@/lib/work-run-preflight";

function issueWasNotFound(error: unknown) {
  return error instanceof Error && /issue.+not found|not found.+issue/i.test(error.message);
}

export async function preflightWorkRun(
  run: Run,
  agent: Pick<Agent, "id" | "name" | "slug">,
): Promise<WorkRunPreflightResult | null> {
  if (!requiresWorkRunPreflight(run.trigger)) return null;

  const expected = expectedWorkRunCondition(run.trigger, agent);
  repository.addRunEvent(run.id, "run_preflight_started", {
    trigger: run.trigger,
    issueKey: run.issueKey,
    expected,
  });

  let issue = null;
  try {
    issue = run.issueKey ? await WorkClient.getIssue(run.issueKey) : null;
  } catch (error) {
    if (!issueWasNotFound(error)) {
      repository.addRunEvent(run.id, "run_preflight_failed", {
        trigger: run.trigger,
        issueKey: run.issueKey,
        error: error instanceof Error ? error.message : "Work preflight failed.",
      });
      throw error;
    }
  }

  const result = evaluateWorkRunPreflight({
    trigger: run.trigger,
    targetAgent: agent,
    issue,
  });
  repository.addRunEvent(run.id, "run_preflight_completed", {
    ...result,
    issueKey: run.issueKey,
  });
  return result;
}
