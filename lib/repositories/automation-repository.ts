import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import type { Automation } from "@/lib/types";

function mapAutomation(row: Row): Automation {
  return {
    id: String(row.id),
    name: String(row.name),
    agentId: String(row.agent_id),
    agentName: row.agent_name ? String(row.agent_name) : undefined,
    cronExpression: row.cron_expression ? String(row.cron_expression) : null,
    prompt: String(row.prompt),
    mode: row.mode as Automation["mode"],
    enabled: bool(row.enabled),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    lastScheduledFor: row.last_scheduled_for
      ? String(row.last_scheduled_for)
      : null,
    missedRunPolicy: row.missed_run_policy === "skip" ? "skip" : "latest_once",
    lastRunId: row.last_run_id ? String(row.last_run_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const automationRepository = {
  listAutomations() {
    return (
      db
        .prepare(
          `SELECT a.*, g.name agent_name,
            (SELECT r.id FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_id
           FROM automations a
           JOIN agents g ON g.id=a.agent_id
           ORDER BY a.enabled DESC,a.name`,
        )
        .all() as Row[]
    ).map(mapAutomation);
  },
  getAutomation(id: string) {
    const row = db
      .prepare(
        `SELECT a.*, g.name agent_name,
          (SELECT r.id FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_id
         FROM automations a
         JOIN agents g ON g.id=a.agent_id
         WHERE a.id=?`,
      )
      .get(id) as Row | undefined;
    return row ? mapAutomation(row) : null;
  },
  createAutomation(input: {
    name: string;
    agentId: string;
    cronExpression: string | null;
    prompt: string;
    mode: Automation["mode"];
    enabled: boolean;
  }) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO automations (id,name,agent_id,cron_expression,prompt,mode,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.agentId,
      input.cronExpression,
      input.prompt,
      input.mode,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp,
    );
    return automationRepository.getAutomation(id)!;
  },
  updateAutomation(
    id: string,
    input: Partial<{
      name: string;
      cronExpression: string | null;
      prompt: string;
      mode: Automation["mode"];
      enabled: boolean;
      lastRunAt: string | null;
      lastScheduledFor: string | null;
      missedRunPolicy: Automation["missedRunPolicy"];
    }>,
  ) {
    const current = automationRepository.getAutomation(id);
    if (!current) return null;
    db.prepare(
      "UPDATE automations SET name=?,cron_expression=?,prompt=?,mode=?,enabled=?,last_run_at=?,last_scheduled_for=?,missed_run_policy=?,updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.cronExpression === undefined
        ? current.cronExpression
        : input.cronExpression,
      input.prompt ?? current.prompt,
      input.mode ?? current.mode,
      (input.enabled ?? current.enabled) ? 1 : 0,
      input.lastRunAt === undefined ? current.lastRunAt : input.lastRunAt,
      input.lastScheduledFor === undefined
        ? current.lastScheduledFor
        : input.lastScheduledFor,
      input.missedRunPolicy ?? current.missedRunPolicy,
      now(),
      id,
    );
    return automationRepository.getAutomation(id);
  },
  claimAutomationOccurrence(automationId: string, scheduledFor: string) {
    const runId = randomUUID();
    const createdAt = now();
    db.prepare(
      `INSERT OR IGNORE INTO automation_occurrences
       (automation_id,scheduled_for,run_id,status,created_at)
       VALUES (?,?,?,'pending',?)`,
    ).run(automationId, scheduledFor, runId, createdAt);
    return db
      .prepare(
        `SELECT automation_id AS automationId,scheduled_for AS scheduledFor,
                run_id AS runId,status,created_at AS createdAt,
                dispatched_at AS dispatchedAt
         FROM automation_occurrences
         WHERE automation_id=? AND scheduled_for=?`,
      )
      .get(automationId, scheduledFor) as {
      automationId: string;
      scheduledFor: string;
      runId: string;
      status: "pending" | "dispatched";
      createdAt: string;
      dispatchedAt: string | null;
    };
  },
  listPendingAutomationOccurrences(limit = 100) {
    return db
      .prepare(
        `SELECT automation_id AS automationId,scheduled_for AS scheduledFor,
                run_id AS runId,status,created_at AS createdAt,
                dispatched_at AS dispatchedAt
         FROM automation_occurrences
         WHERE status='pending'
         ORDER BY created_at,automation_id
         LIMIT ?`,
      )
      .all(limit) as Array<{
      automationId: string;
      scheduledFor: string;
      runId: string;
      status: "pending";
      createdAt: string;
      dispatchedAt: null;
    }>;
  },
  markAutomationOccurrenceDispatched(
    automationId: string,
    scheduledFor: string,
    runId: string,
  ) {
    return db
      .prepare(
        `UPDATE automation_occurrences
         SET status='dispatched',dispatched_at=?
         WHERE automation_id=? AND scheduled_for=? AND run_id=? AND status='pending'`,
      )
      .run(now(), automationId, scheduledFor, runId).changes;
  },
};
