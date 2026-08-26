import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { telemetryJson, type Row } from "@/lib/repositories/repository-helpers";
import type { Run, RunEvent, RunStatus } from "@/lib/types";

function mapRun(row: Row): Run {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    automationId: row.automation_id ? String(row.automation_id) : null,
    trigger: row.trigger as Run["trigger"],
    mode: row.mode as Run["mode"],
    issueKey: row.issue_key ? String(row.issue_key) : null,
    runInstructions: String(row.run_instructions ?? ""),
    status: row.status as RunStatus,
    runtime: String(row.runtime),
    model: String(row.model ?? "default"),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    error: row.error ? String(row.error) : null,
    usage: telemetryJson(row.usage_json, null),
    createdAt: String(row.created_at ?? row.started_at ?? ""),
    queuedAt: String(row.queued_at ?? row.created_at ?? row.started_at ?? ""),
    attemptCount: Number(row.attempt_count ?? 0),
    runnerRunId: row.runner_run_id ? String(row.runner_run_id) : null,
    runnerEventId: Number(row.runner_event_id ?? 0),
  };
}

export const runRepository = {
  getActiveRunForThread(threadId: string) {
    const row = db
      .prepare(
        "SELECT * FROM runs WHERE thread_id=? AND status IN ('queued','running','waiting_approval') ORDER BY rowid DESC LIMIT 1",
      )
      .get(threadId) as Row | undefined;
    return row ? mapRun(row) : null;
  },
  createRun(input: {
    id?: string;
    agentId: string;
    threadId?: string | null;
    automationId?: string | null;
    runtime?: string;
    model?: string;
    trigger: Run["trigger"];
    mode: Run["mode"];
    issueKey?: string | null;
    runInstructions: string;
  }) {
    const id = input.id ?? randomUUID();
    const createdAt = now();
    db.prepare(
      "INSERT INTO runs (id,agent_id,thread_id,automation_id,status,runtime,model,trigger,mode,issue_key,run_instructions,created_at,queued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.agentId,
      input.threadId ?? null,
      input.automationId ?? null,
      "queued",
      input.runtime ?? "codex",
      input.model ?? "default",
      input.trigger,
      input.mode,
      input.issueKey ?? null,
      input.runInstructions,
      createdAt,
      createdAt,
    );
    return runRepository.getRun(id)!;
  },
  getRun(id: string) {
    const row = db.prepare("SELECT * FROM runs WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapRun(row) : null;
  },
  listRuns(limit = 100) {
    return (
      db
        .prepare(
          `SELECT * FROM runs
           WHERE status IN ('queued','running','waiting_approval')
              OR id IN (
                SELECT id FROM runs
                ORDER BY COALESCE(started_at,'') DESC,rowid DESC
                LIMIT ?
              )
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'waiting_approval' THEN 1
               WHEN 'queued' THEN 2
               ELSE 3
             END,
             CASE WHEN status='queued' THEN queued_at END ASC,
             COALESCE(started_at,created_at) DESC,rowid DESC`,
        )
        .all(limit) as Row[]
    ).map(mapRun);
  },
  listAgentActivityRuns() {
    return (
      db
        .prepare(
          `SELECT * FROM runs
           WHERE status IN ('queued','running','waiting_approval')
              OR rowid IN (SELECT MAX(rowid) FROM runs GROUP BY agent_id)
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'waiting_approval' THEN 1
               WHEN 'queued' THEN 2
               ELSE 3
             END,
             CASE WHEN status='queued' THEN queued_at END ASC,
             COALESCE(started_at,created_at) DESC,rowid DESC`,
        )
        .all() as Row[]
    ).map(mapRun);
  },
  updateRun(
    id: string,
    status: RunStatus,
    extra: {
      error?: string | null;
      usage?: Record<string, unknown> | null;
    } = {},
  ) {
    const run = runRepository.getRun(id);
    if (!run) return null;
    const started = run.startedAt ?? (status !== "queued" ? now() : null);
    const completed = ["completed", "failed", "skipped", "cancelled"].includes(
      status,
    )
      ? now()
      : null;
    db.prepare(
      "UPDATE runs SET status=?,started_at=?,completed_at=?,error=?,usage_json=? WHERE id=?",
    ).run(
      status,
      started,
      completed,
      extra.error ?? run.error,
      extra.usage
        ? JSON.stringify(extra.usage)
        : run.usage
          ? JSON.stringify(run.usage)
          : null,
      id,
    );
    return runRepository.getRun(id);
  },
  updateRunRunnerCursor(
    id: string,
    leaseOwner: string,
    runnerRunId: string,
    runnerEventId: number,
    reset = false,
  ) {
    const comparison = reset
      ? ""
      : "AND runner_run_id=? AND runner_event_id < ?";
    const parameters = reset
      ? [runnerRunId, runnerEventId, id, leaseOwner]
      : [
          runnerRunId,
          runnerEventId,
          id,
          leaseOwner,
          runnerRunId,
          runnerEventId,
        ];
    return db
      .prepare(
        `UPDATE runs SET runner_run_id=?,runner_event_id=?
         WHERE id=? AND lease_owner=? ${comparison}`,
      )
      .run(...parameters).changes;
  },
  ownsRunLease(id: string, leaseOwner: string) {
    const row = db
      .prepare(
        `SELECT 1 AS owned FROM runs
         WHERE id=? AND lease_owner=? AND lease_expires_at > ?`,
      )
      .get(id, leaseOwner, now()) as { owned: number } | undefined;
    return row?.owned === 1;
  },
  requeueRunForRunnerReconnect(id: string, leaseOwner: string, error: string) {
    const attemptCount = runRepository.getRun(id)?.attemptCount ?? 1;
    const retryAt = new Date(
      Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount - 1, 6)),
    ).toISOString();
    return db
      .prepare(
        `UPDATE runs
         SET status='queued',started_at=NULL,completed_at=NULL,error=?,runner_retry_at=?
         WHERE id=? AND lease_owner=? AND lease_expires_at > ?`,
      )
      .run(error, retryAt, id, leaseOwner, now()).changes;
  },
  resumeWhenApprovalsClear(runId: string) {
    return (
      db
        .prepare(
          `UPDATE runs
           SET status='running',completed_at=NULL
           WHERE id=?
             AND status='waiting_approval'
             AND NOT EXISTS (
               SELECT 1 FROM approvals
               WHERE run_id=? AND status IN ('pending','resolving')
             )`,
        )
        .run(runId, runId).changes === 1
    );
  },
  cancelIfActive(runId: string, error: string) {
    const timestamp = now();
    return (
      db
        .prepare(
          `UPDATE runs
           SET status='cancelled',started_at=COALESCE(started_at,?),completed_at=?,error=?
           WHERE id=? AND status IN ('queued','running','waiting_approval')`,
        )
        .run(timestamp, timestamp, error, runId).changes === 1
    );
  },
  addRunEvent(
    runId: string,
    type: string,
    payload: Record<string, unknown> = {},
  ) {
    const id = randomUUID(),
      createdAt = now();
    db.prepare(
      "INSERT INTO run_events (id,run_id,type,payload,created_at) VALUES (?,?,?,?,?)",
    ).run(id, runId, type, JSON.stringify(payload), createdAt);
    return { id, runId, type, payload, createdAt } satisfies RunEvent;
  },
  listRunEvents(runId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM run_events WHERE run_id=? ORDER BY created_at,rowid",
        )
        .all(runId) as Row[]
    ).map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      type: String(row.type),
      payload: telemetryJson(row.payload, {}),
      createdAt: String(row.created_at),
    }));
  },
  hasRunEvent(runId: string, type: string) {
    return Boolean(
      db
        .prepare(
          "SELECT 1 AS found FROM run_events WHERE run_id=? AND type=? LIMIT 1",
        )
        .get(runId, type),
    );
  },
};
