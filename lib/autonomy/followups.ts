import "server-only";

import { badRequest, conflict, notFound } from "@/lib/api";
import { autonomyRepository, type Followup } from "@/lib/repositories/autonomy-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { allows, autonomyState, getAutonomyPolicy, logAutonomyEvent } from "@/lib/autonomy/service";
import { DEFAULT_PLANNING_PROMPT, PLANNING_NOTE_PREFIX } from "@/lib/autonomy/policy";
import { runDepth, startAutonomyRun } from "@/lib/autonomy/runs";

const MAX_PENDING_PER_AGENT = 25;
const MAX_DAYS_AHEAD = 90;

export type { Followup };

export function listFollowups(input: { agentId?: string; status?: Followup["status"]; limit?: number } = {}) {
  return autonomyRepository.listFollowups(input);
}

export function scheduleFollowup(input: {
  agentId: string;
  runId: string | null;
  dueAt: Date;
  note: string;
  issueKey?: string | null;
}) {
  if (!allows("followups", input.agentId)) throw conflict("Follow-ups are off at this autonomy level.", "AUTONOMY_DISABLED");
  const due = input.dueAt.getTime();
  if (!Number.isFinite(due)) throw badRequest("Give a valid time.");
  if (due < Date.now() + 60_000) throw badRequest("Schedule the follow-up at least one minute ahead.");
  if (due > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw badRequest(`Follow-ups can be at most ${MAX_DAYS_AHEAD} days ahead.`);
  const note = input.note.trim();
  if (!note) throw badRequest("Write what to check.");
  if (listFollowups({ agentId: input.agentId, status: "pending" }).length >= MAX_PENDING_PER_AGENT)
    throw conflict(`An agent can have at most ${MAX_PENDING_PER_AGENT} pending follow-ups. Cancel some first.`);
  const followup = autonomyRepository.createFollowup({
    agentId: input.agentId,
    dueAt: new Date(due).toISOString(),
    note: note.slice(0, 4_000),
    issueKey: input.issueKey?.trim().toUpperCase() || null,
    sourceRunId: input.runId,
    depth: runDepth(input.runId),
  });
  const agent = agentRepository.getAgent(input.agentId);
  logAutonomyEvent({
    kind: "followup_scheduled",
    actor: `agent:${agent?.slug ?? input.agentId}`,
    summary: `${agent?.name ?? "Agent"} at ${new Date(due).toISOString()}: ${note.slice(0, 200)}`,
    payload: { followupId: followup.id },
  });
  return followup;
}

/** A follow-up of the lead agent that it scheduled as its next planning loop. */
export function isPlanningFollowup(followup: Pick<Followup, "agentId" | "note">) {
  const policy = getAutonomyPolicy();
  return (
    followup.agentId === policy.leadAgentId &&
    followup.note.trim().toLowerCase().startsWith(PLANNING_NOTE_PREFIX.toLowerCase())
  );
}

/** The next planning loop the lead scheduled for itself, if any. */
export function nextScheduledPlanning(leadAgentId: string) {
  return listFollowups({ agentId: leadAgentId, status: "pending" })
    .filter((followup) => isPlanningFollowup(followup))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;
}

function followupRunInput(followup: Followup) {
  if (isPlanningFollowup(followup)) {
    autonomyState.set("last_planning_at", new Date().toISOString());
    const policy = getAutonomyPolicy();
    return {
      prompt: [
        policy.planningPrompt.trim() || DEFAULT_PLANNING_PROMPT,
        "",
        `You scheduled this loop at ${followup.createdAt} with this note:`,
        followup.note,
      ].join("\n"),
      mode: "review" as const,
      origin: "planning" as const,
      parentRunId: null,
      title: `Planning loop ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    };
  }
  return {
    prompt: [
      "This is a follow-up you scheduled for yourself.",
      `Scheduled at: ${followup.createdAt}`,
      "",
      followup.note,
      "",
      "Check the current state and act. Before you finish, schedule your next follow-up if your work goes on.",
    ].join("\n"),
    mode: undefined,
    origin: "followup" as const,
    parentRunId: followup.sourceRunId,
    title: `Follow-up: ${followup.note.slice(0, 80)}`,
  };
}

export function cancelFollowup(id: string, actor: string, agentId?: string) {
  const followup = autonomyRepository.getFollowup(id);
  if (!followup || (agentId && followup.agentId !== agentId)) throw notFound("Follow-up not found.");
  if (!autonomyRepository.setFollowupStatus(id, "cancelled", "pending")) throw conflict("This follow-up is no longer pending.");
  logAutonomyEvent({ kind: "followup_cancelled", actor, summary: followup.note.slice(0, 200), payload: { followupId: id } });
}

/** Starts the agent for every follow-up that is due. */
export function fireDueFollowups() {
  const due = autonomyRepository.listDueFollowups(new Date().toISOString());
  for (const followup of due) {
    const claimed = autonomyRepository.setFollowupStatus(followup.id, "fired", "pending");
    if (!claimed) continue;
    if (!allows("followups", followup.agentId)) {
      autonomyRepository.setFollowupStatus(followup.id, "skipped");
      continue;
    }
    try {
      const input = followupRunInput(followup);
      const run = startAutonomyRun({
        agentId: followup.agentId,
        prompt: input.prompt,
        mode: input.mode,
        issueKey: followup.issueKey,
        parentRunId: input.parentRunId,
        origin: input.origin,
        title: input.title,
        actor: "system",
      });
      autonomyRepository.setFollowupRun(followup.id, run.id);
    } catch (error) {
      autonomyRepository.setFollowupStatus(followup.id, "skipped");
      logAutonomyEvent({
        kind: "followup_skipped",
        actor: "system",
        summary: `${followup.note.slice(0, 120)}: ${error instanceof Error ? error.message : String(error)}`,
        payload: { followupId: followup.id },
      });
    }
  }
  return due.length;
}
