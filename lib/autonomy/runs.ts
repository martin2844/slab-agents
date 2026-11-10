import "server-only";

import { conflict, notFound } from "@/lib/api";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { createRunExecution, executeRunInBackground } from "@/lib/run-service";
import { activeRunCount, allows, autonomyLimits, logAutonomyEvent } from "@/lib/autonomy/service";
import { autonomyRepository } from "@/lib/repositories/autonomy-repository";

export type AutonomyOrigin = "delegate" | "followup" | "question" | "planning" | "telegram";

export function runDepth(runId: string | null | undefined) {
  if (!runId) return 0;
  return autonomyRepository.runDepth(runId);
}

export function autonomousRunsLastDay() {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  return autonomyRepository.autonomousRunsSince(since);
}

/** Checks the guards for a new autonomous run. Throws a clear error when a guard stops it. */
export function assertAutonomyGuards(input: { agentId: string; parentRunId?: string | null; origin: AutonomyOrigin }) {
  // A follow-up is the same agent waking up later, not a new hop: it keeps the depth
  // of the run that scheduled it, so an agent can keep pacing itself day after day.
  const parentDepth = input.parentRunId ? runDepth(input.parentRunId) : -1;
  const depth = input.origin === "followup" ? Math.max(parentDepth, 0) : parentDepth + 1;
  if (!allows("guards", input.agentId)) return depth;
  const limits = autonomyLimits();
  // Answers and Telegram tasks come from the human: only self-started runs count.
  if (!["delegate", "followup", "planning"].includes(input.origin)) return depth;
  if (["delegate", "followup"].includes(input.origin) && depth > limits.maxDelegationDepth) {
    throw conflict(
      `Delegation depth limit reached (${limits.maxDelegationDepth}). Finish the work in this run or ask the human.`,
      "AUTONOMY_DEPTH_LIMIT",
    );
  }
  if (autonomousRunsLastDay() >= limits.maxAutonomousRunsPerDay) {
    throw conflict(
      `The daily limit of autonomous runs (${limits.maxAutonomousRunsPerDay}) was reached.`,
      "AUTONOMY_DAILY_LIMIT",
    );
  }
  return depth;
}

/** Starts a run on behalf of autonomy (delegation, follow-up, answer, planning). */
export function startAutonomyRun(input: {
  agentId: string;
  prompt: string;
  mode?: "task" | "review" | "assignment" | "work_item";
  issueKey?: string | null;
  parentRunId?: string | null;
  origin: AutonomyOrigin;
  title: string;
  threadId?: string | null;
  actor: string;
}) {
  const agent = agentRepository.getAgent(input.agentId);
  if (!agent) throw notFound("Agent not found.");
  if (!agent.enabled) throw conflict(`${agent.name} is disabled.`, "AGENT_DISABLED");
  // Runs that start on their own stop with a pause (level 0). Runs the human asks for do not.
  if (["delegate", "followup", "planning"].includes(input.origin) && !allows("triggers", agent.id)) {
    throw conflict("Autonomy is paused (level 0).", "AUTONOMY_PAUSED");
  }
  const depth = assertAutonomyGuards({ agentId: agent.id, parentRunId: input.parentRunId, origin: input.origin });
  const issueKey = input.issueKey?.trim() ? input.issueKey.trim().toUpperCase() : null;
  const mode = input.mode ?? (issueKey ? "assignment" : "task");
  const thread =
    input.threadId && conversationRepository.getThread(input.threadId)?.agentId === agent.id
      ? conversationRepository.getThread(input.threadId)!
      : conversationRepository.createThread(agent.id, input.title.slice(0, 120));
  const run = createRunExecution({
    agentId: agent.id,
    threadId: thread.id,
    trigger: "autonomy",
    mode: issueKey ? mode : mode === "review" ? "review" : "task",
    issueKey: issueKey && (mode === "assignment" || mode === "work_item") ? issueKey : null,
    prompt: input.prompt,
  });
  autonomyRepository.addLineage({ runId: run.id, parentRunId: input.parentRunId ?? null, depth, origin: input.origin });
  logAutonomyEvent({
    kind: `run_${input.origin}`,
    actor: input.actor,
    summary: `${agent.name}: ${input.title}`,
    payload: { runId: run.id, parentRunId: input.parentRunId ?? null, depth },
  });
  // At the concurrency cap the run waits in the queue; the dispatcher starts it when a slot frees.
  if (!allows("guards", agent.id) || activeRunCount() < autonomyLimits().maxConcurrentRuns) {
    void executeRunInBackground(run.id).catch((error) =>
      console.error("[autonomy] run failed to execute", error),
    );
  }
  return run;
}
