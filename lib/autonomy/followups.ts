import "server-only";

import { badRequest, conflict, notFound } from "@/lib/api";
import { autonomyRepository, type Followup } from "@/lib/repositories/autonomy-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { allows, logAutonomyEvent } from "@/lib/autonomy/service";
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
      const run = startAutonomyRun({
        agentId: followup.agentId,
        prompt: [
          "This is a follow-up you scheduled for yourself.",
          `Scheduled at: ${followup.createdAt}`,
          "",
          followup.note,
          "",
          "Check the current state, act if needed, and schedule another follow-up only if it is still useful.",
        ].join("\n"),
        issueKey: followup.issueKey,
        parentRunId: followup.sourceRunId,
        origin: "followup",
        title: `Follow-up: ${followup.note.slice(0, 80)}`,
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
