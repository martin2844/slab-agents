import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { json, type Row } from "@/lib/repositories/repository-helpers";

const text = (value: unknown) => (value == null ? null : String(value));

export type AutonomyEvent = {
  id: string;
  kind: string;
  actor: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type HumanRequest = {
  id: string;
  kind: "question" | "update";
  runId: string | null;
  agentId: string | null;
  threadId: string | null;
  issueKey: string | null;
  question: string;
  options: string[];
  urgency: "low" | "normal" | "high";
  status: "pending" | "answered" | "expired" | "sent";
  answer: string | null;
  answeredBy: string | null;
  defaultAnswer: string | null;
  expiresAt: string | null;
  continuationRunId: string | null;
  createdAt: string;
  answeredAt: string | null;
};

export type Followup = {
  id: string;
  agentId: string;
  dueAt: string;
  note: string;
  issueKey: string | null;
  sourceRunId: string | null;
  status: "pending" | "fired" | "cancelled" | "skipped";
  firedRunId: string | null;
  createdAt: string;
};

export type ProposalStatus = "pending" | "applied" | "rejected" | "failed";

export type StoredProposal = {
  id: string;
  kind: string;
  agentId: string | null;
  runId: string | null;
  targetId: string | null;
  summary: string;
  payload: Record<string, unknown>;
  status: ProposalStatus;
  resultId: string | null;
  error: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
};

function mapEvent(row: Row): AutonomyEvent {
  return {
    id: String(row.id),
    kind: String(row.kind),
    actor: String(row.actor),
    summary: String(row.summary),
    payload: json<Record<string, unknown>>(row.payload_json, {}),
    createdAt: String(row.created_at),
  };
}

function mapRequest(row: Row): HumanRequest {
  return {
    id: String(row.id),
    kind: row.kind as HumanRequest["kind"],
    runId: text(row.run_id),
    agentId: text(row.agent_id),
    threadId: text(row.thread_id),
    issueKey: text(row.issue_key),
    question: String(row.question),
    options: json<string[]>(row.options_json, []),
    urgency: String(row.urgency ?? "normal") as HumanRequest["urgency"],
    status: row.status as HumanRequest["status"],
    answer: text(row.answer),
    answeredBy: text(row.answered_by),
    defaultAnswer: text(row.default_answer),
    expiresAt: text(row.expires_at),
    continuationRunId: text(row.continuation_run_id),
    createdAt: String(row.created_at),
    answeredAt: text(row.answered_at),
  };
}

function mapFollowup(row: Row): Followup {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    dueAt: String(row.due_at),
    note: String(row.note),
    issueKey: text(row.issue_key),
    sourceRunId: text(row.source_run_id),
    status: row.status as Followup["status"],
    firedRunId: text(row.fired_run_id),
    createdAt: String(row.created_at),
  };
}

function mapProposal(row: Row): StoredProposal {
  return {
    id: String(row.id),
    kind: String(row.kind),
    agentId: text(row.agent_id),
    runId: text(row.run_id),
    targetId: text(row.target_id),
    summary: String(row.summary),
    payload: json<Record<string, unknown>>(row.payload_json, {}),
    status: row.status as ProposalStatus,
    resultId: text(row.result_id),
    error: text(row.error),
    decidedBy: text(row.decided_by),
    createdAt: String(row.created_at),
    decidedAt: text(row.decided_at),
  };
}

const count = (sql: string, ...values: unknown[]) =>
  Number((db.prepare(sql).get(...values) as Row).value ?? 0);

export const autonomyRepository = {
  // Events
  addEvent(input: { kind: string; actor: string; summary: string; payload: Record<string, unknown> }) {
    db.prepare(
      "INSERT INTO autonomy_events (id,kind,actor,summary,payload_json,created_at) VALUES (?,?,?,?,?,?)",
    ).run(randomUUID(), input.kind, input.actor, input.summary.slice(0, 2_000), JSON.stringify(input.payload), now());
  },
  listEvents(limit = 100) {
    return (
      db.prepare("SELECT * FROM autonomy_events ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Row[]
    ).map(mapEvent);
  },

  // Runs
  activeRunCount() {
    return count("SELECT COUNT(*) AS value FROM runs WHERE status='running'");
  },
  runDepth(runId: string) {
    const row = db.prepare("SELECT depth FROM run_lineage WHERE run_id=?").get(runId) as Row | undefined;
    return row ? Number(row.depth) : 0;
  },
  autonomousRunsSince(since: string) {
    return count("SELECT COUNT(*) AS value FROM run_lineage WHERE created_at >= ?", since);
  },
  addLineage(input: { runId: string; parentRunId: string | null; depth: number; origin: string }) {
    db.prepare(
      "INSERT INTO run_lineage (run_id,parent_run_id,depth,origin,created_at) VALUES (?,?,?,?,?)",
    ).run(input.runId, input.parentRunId, input.depth, input.origin, now());
  },
  /** Queued runs that autonomy started on its own (they wait while autonomy is paused). */
  selfStartedRunIds(runIds: string[]) {
    if (!runIds.length) return new Set<string>();
    const rows = db
      .prepare(
        `SELECT run_id FROM run_lineage WHERE origin IN ('delegate','followup','planning') AND run_id IN (${runIds.map(() => "?").join(",")})`,
      )
      .all(...runIds) as Row[];
    return new Set(rows.map((row) => String(row.run_id)));
  },
  /** Agents with a run that holds a runner slot now. */
  busyAgentIds() {
    return new Set(
      (db.prepare("SELECT DISTINCT agent_id FROM runs WHERE status='running'").all() as Row[]).map((row) => String(row.agent_id)),
    );
  },
  /** New emails and WhatsApp messages (not replies) sent in the window, by any agent. */
  outboundSendsSince(since: string) {
    return count(
      `SELECT COUNT(*) AS value FROM run_events e JOIN runs r ON r.id=e.run_id
       WHERE e.type='tool_completed' AND e.created_at >= ? AND r.trigger != 'whatsapp'
         AND json_extract(e.payload,'$.tool') IN ('email_send','whatsapp_send_text')
         AND COALESCE(json_extract(e.payload,'$.success'),1) IN (1,'true')`,
      since,
    );
  },
  recentRunsByOrigin(origin: string, limit = 3) {
    return (
      db.prepare("SELECT run_id FROM run_lineage WHERE origin=? ORDER BY created_at DESC LIMIT ?").all(origin, limit) as Row[]
    ).map((row) => String(row.run_id));
  },

  // Control tokens
  saveControlToken(runId: string, agentId: string, tokenHash: string) {
    db.prepare(
      "INSERT INTO run_control_tokens (run_id,agent_id,token_hash,created_at) VALUES (?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET agent_id=excluded.agent_id, token_hash=excluded.token_hash, created_at=excluded.created_at",
    ).run(runId, agentId, tokenHash, now());
  },
  getControlToken(runId: string) {
    const row = db.prepare("SELECT agent_id, token_hash FROM run_control_tokens WHERE run_id=?").get(runId) as Row | undefined;
    return row ? { agentId: String(row.agent_id), tokenHash: String(row.token_hash) } : null;
  },

  // Questions and updates for the human
  createRequest(input: {
    kind: HumanRequest["kind"];
    runId: string | null;
    agentId: string | null;
    threadId: string | null;
    issueKey: string | null;
    question: string;
    options: string[];
    urgency: HumanRequest["urgency"];
    status: HumanRequest["status"];
    defaultAnswer: string | null;
    expiresAt: string | null;
  }) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO human_requests (id,kind,run_id,agent_id,thread_id,issue_key,question,options_json,urgency,status,default_answer,expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.kind,
      input.runId,
      input.agentId,
      input.threadId,
      input.issueKey,
      input.question,
      JSON.stringify(input.options),
      input.urgency,
      input.status,
      input.defaultAnswer,
      input.expiresAt,
      now(),
    );
    return autonomyRepository.getRequest(id)!;
  },
  getRequest(id: string) {
    const row = db.prepare("SELECT * FROM human_requests WHERE id=?").get(id) as Row | undefined;
    return row ? mapRequest(row) : null;
  },
  listRequests(input: { status?: HumanRequest["status"]; limit?: number } = {}) {
    const rows = input.status
      ? db.prepare("SELECT * FROM human_requests WHERE status=? ORDER BY created_at DESC LIMIT ?").all(input.status, input.limit ?? 100)
      : db.prepare("SELECT * FROM human_requests ORDER BY created_at DESC LIMIT ?").all(input.limit ?? 100);
    return (rows as Row[]).map(mapRequest);
  },
  listExpiredQuestions(at: string) {
    return (
      db.prepare("SELECT * FROM human_requests WHERE status='pending' AND expires_at IS NOT NULL AND expires_at <= ?").all(at) as Row[]
    ).map(mapRequest);
  },
  /** Moves a pending question to answered or expired. False when it was no longer pending. */
  closeRequest(id: string, input: { status: "answered" | "expired"; answer: string | null; answeredBy: string }) {
    return (
      db
        .prepare("UPDATE human_requests SET status=?, answer=?, answered_by=?, answered_at=? WHERE id=? AND status='pending'")
        .run(input.status, input.answer, input.answeredBy, now(), id).changes === 1
    );
  },
  setContinuation(id: string, runId: string) {
    db.prepare("UPDATE human_requests SET continuation_run_id=? WHERE id=?").run(runId, id);
  },

  // Follow-ups
  createFollowup(input: { agentId: string; dueAt: string; note: string; issueKey: string | null; sourceRunId: string | null; depth: number }) {
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO agent_wakeups (id,agent_id,due_at,note,issue_key,source_run_id,depth,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, input.agentId, input.dueAt, input.note, input.issueKey, input.sourceRunId, input.depth, "pending", timestamp, timestamp);
    return autonomyRepository.getFollowup(id)!;
  },
  getFollowup(id: string) {
    const row = db.prepare("SELECT * FROM agent_wakeups WHERE id=?").get(id) as Row | undefined;
    return row ? mapFollowup(row) : null;
  },
  listFollowups(input: { agentId?: string; status?: Followup["status"]; limit?: number } = {}) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.agentId) {
      clauses.push("agent_id=?");
      values.push(input.agentId);
    }
    if (input.status) {
      clauses.push("status=?");
      values.push(input.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (
      db.prepare(`SELECT * FROM agent_wakeups ${where} ORDER BY due_at LIMIT ?`).all(...values, input.limit ?? 100) as Row[]
    ).map(mapFollowup);
  },
  listDueFollowups(at: string, limit = 20) {
    return (
      db.prepare("SELECT * FROM agent_wakeups WHERE status='pending' AND due_at <= ? ORDER BY due_at LIMIT ?").all(at, limit) as Row[]
    ).map(mapFollowup);
  },
  /** Changes the status of a follow-up; `from` makes it a compare-and-set. */
  setFollowupStatus(id: string, status: Followup["status"], from?: Followup["status"]) {
    const sql = from
      ? "UPDATE agent_wakeups SET status=?, updated_at=? WHERE id=? AND status=?"
      : "UPDATE agent_wakeups SET status=?, updated_at=? WHERE id=?";
    return db.prepare(sql).run(...(from ? [status, now(), id, from] : [status, now(), id])).changes === 1;
  },
  setFollowupRun(id: string, runId: string) {
    db.prepare("UPDATE agent_wakeups SET fired_run_id=?, updated_at=? WHERE id=?").run(runId, now(), id);
  },

  // Proposals
  createProposal(input: { kind: string; agentId: string; runId: string | null; targetId: string | null; summary: string; payload: Record<string, unknown> }) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO autonomy_proposals (id,kind,agent_id,run_id,target_id,summary,payload_json,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, input.kind, input.agentId, input.runId, input.targetId, input.summary, JSON.stringify(input.payload), "pending", now());
    return autonomyRepository.getProposal(id)!;
  },
  getProposal(id: string) {
    const row = db.prepare("SELECT * FROM autonomy_proposals WHERE id=?").get(id) as Row | undefined;
    return row ? mapProposal(row) : null;
  },
  listProposals(input: { status?: ProposalStatus; limit?: number } = {}) {
    const rows = input.status
      ? db.prepare("SELECT * FROM autonomy_proposals WHERE status=? ORDER BY created_at DESC LIMIT ?").all(input.status, input.limit ?? 100)
      : db.prepare("SELECT * FROM autonomy_proposals ORDER BY created_at DESC LIMIT ?").all(input.limit ?? 100);
    return (rows as Row[]).map(mapProposal);
  },
  /** Decides a pending proposal. False when it was already decided. */
  decideProposal(id: string, input: { status: Exclude<ProposalStatus, "pending">; decidedBy: string; resultId?: string | null; error?: string | null }) {
    return (
      db
        .prepare("UPDATE autonomy_proposals SET status=?, result_id=?, error=?, decided_by=?, decided_at=? WHERE id=? AND status='pending'")
        .run(input.status, input.resultId ?? null, input.error ?? null, input.decidedBy, now(), id).changes === 1
    );
  },

  // Approvals that wait for the human
  listPendingApprovals(limit = 50) {
    return (
      db
        .prepare(
          `SELECT a.id, a.created_at, r.agent_id, e.reminded_at
           FROM approvals a JOIN runs r ON r.id=a.run_id
           LEFT JOIN approval_escalations e ON e.approval_id=a.id
           WHERE a.status='pending' ORDER BY a.created_at LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      agentId: String(row.agent_id),
      remindedAt: text(row.reminded_at),
    }));
  },
  markApprovalReminded(approvalId: string) {
    db.prepare(
      "INSERT INTO approval_escalations (approval_id,reminded_at) VALUES (?,?) ON CONFLICT(approval_id) DO UPDATE SET reminded_at=excluded.reminded_at",
    ).run(approvalId, now());
  },
  markApprovalResolved(approvalId: string, resolution: string) {
    db.prepare(
      "INSERT INTO approval_escalations (approval_id,resolved_at,resolution) VALUES (?,?,?) ON CONFLICT(approval_id) DO UPDATE SET resolved_at=excluded.resolved_at, resolution=excluded.resolution",
    ).run(approvalId, now(), resolution);
  },
};
