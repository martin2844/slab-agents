import "server-only";

import { autonomyRepository } from "@/lib/repositories/autonomy-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { resolveApprovalAction } from "@/lib/approval-resolution";
import { DEFAULT_PLANNING_PROMPT } from "@/lib/autonomy/policy";
import {
  allows,
  autonomyState,
  capability,
  getAutonomyPolicy,
  listAutonomyEvents,
  logAutonomyEvent,
} from "@/lib/autonomy/service";
import { fireDueFollowups, nextScheduledPlanning } from "@/lib/autonomy/followups";
import { expireHumanRequests, listHumanRequests } from "@/lib/autonomy/human-requests";
import { startAutonomyRun } from "@/lib/autonomy/runs";
import { getTelegramStatus, remindApproval, sendToOperator, statusText } from "@/lib/telegram/service";

const TERMINAL = new Set(["completed", "failed", "skipped", "cancelled"]);

function planningRunActive() {
  return autonomyRepository.recentRunsByOrigin("planning").some((runId) => {
    const run = runRepository.getRun(runId);
    return run && !TERMINAL.has(run.status);
  });
}

/**
 * Fallback planning loop. The lead schedules its own loops ("Planning loop:" follow-ups);
 * Slab starts one only after `planningEveryHours` without a loop and with none scheduled
 * within the next `planningEveryHours`.
 */
export function tickPlanning(current = new Date()) {
  const policy = getAutonomyPolicy();
  const lead = policy.leadAgentId ? agentRepository.getAgent(policy.leadAgentId) : null;
  if (!lead?.enabled || !allows("planning", lead.id)) return null;
  const last = autonomyState.get("last_planning_at");
  const fallbackMs = policy.limits.planningEveryHours * 3_600_000;
  if (last && current.getTime() - Date.parse(last) < fallbackMs) return null;
  const scheduled = nextScheduledPlanning(lead.id);
  if (scheduled && Date.parse(scheduled.dueAt) - current.getTime() < fallbackMs) return null;
  if (planningRunActive()) return null;
  autonomyState.set("last_planning_at", current.toISOString());
  try {
    return startAutonomyRun({
      agentId: lead.id,
      prompt: policy.planningPrompt.trim() || DEFAULT_PLANNING_PROMPT,
      mode: "review",
      origin: "planning",
      title: `Planning loop ${current.toISOString().slice(0, 16).replace("T", " ")}`,
      actor: "system",
    });
  } catch (error) {
    logAutonomyEvent({
      kind: "planning_skipped",
      actor: "system",
      summary: `Planning loop skipped: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

/** Approvals that wait too long: remind on Telegram, then deny when the policy says so. */
export async function tickApprovalTimeouts(current = new Date()) {
  const limits = getAutonomyPolicy().limits;
  for (const row of autonomyRepository.listPendingApprovals()) {
    const mode = capability("approval_timeout", row.agentId);
    if (mode === "wait") continue;
    const ageMinutes = (current.getTime() - Date.parse(row.createdAt)) / 60_000;
    const id = row.id;
    if (mode === "deny" && ageMinutes >= limits.approvalDenyHours * 60) {
      try {
        await resolveApprovalAction(id, "deny");
        autonomyRepository.markApprovalResolved(id, "denied_timeout");
        logAutonomyEvent({ kind: "approval_denied_timeout", actor: "system", summary: `Approval denied after ${limits.approvalDenyHours} h without an answer.`, payload: { approvalId: id } });
      } catch (error) {
        console.error("[autonomy] could not deny approval", error);
      }
      continue;
    }
    if (!row.remindedAt && ageMinutes >= limits.approvalRemindMinutes) {
      autonomyRepository.markApprovalReminded(id);
      await remindApproval(id, Math.round(ageMinutes)).catch((error) => console.error("[autonomy] reminder failed", error));
    }
  }
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

/** Daily Telegram digest at the configured local hour (only above level 1 or when Telegram is linked). */
export async function tickDigest(current = new Date()) {
  const policy = getAutonomyPolicy();
  if (policy.limits.digestHour === null || policy.level < 2) return false;
  if (!getTelegramStatus().linked) return false;
  const { day, hour } = localParts(current, policy.limits.timezone);
  if (hour !== policy.limits.digestHour || autonomyState.get("last_digest_day") === day) return false;
  autonomyState.set("last_digest_day", day);
  const since = new Date(current.getTime() - 24 * 3_600_000).toISOString();
  const events = listAutonomyEvents(500).filter((event) => event.createdAt >= since);
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  const questions = listHumanRequests({ status: "pending" });
  await sendToOperator({
    kind: "digest",
    refId: day,
    text: [
      `☀️ Resumen del ${day}`,
      "",
      statusText(),
      ...(counts.size
        ? ["", "Actividad autónoma (24 h):", ...[...counts.entries()].map(([kind, count]) => `• ${kind.replaceAll("_", " ")}: ${count}`)]
        : []),
      ...(questions.length ? ["", "Preguntas sin responder:", ...questions.slice(0, 5).map((request) => `• ${request.question.slice(0, 160)}`)] : []),
    ].join("\n"),
  });
  return true;
}

const tickState = globalThis as unknown as { slabAutonomyBusy?: boolean };

/** Runs every scheduler tick (30 s). Each part checks its own capability. */
export async function tickAutonomy() {
  if (tickState.slabAutonomyBusy) return;
  tickState.slabAutonomyBusy = true;
  try {
    // Paused (level 0): follow-ups, expired questions, and planning wait for the resume.
    if (allows("triggers")) {
      fireDueFollowups();
      expireHumanRequests();
      tickPlanning();
    }
    await tickApprovalTimeouts();
    await tickDigest();
  } finally {
    tickState.slabAutonomyBusy = false;
  }
}
