import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import type { Approval } from "@/lib/types";

type Row = Record<string, unknown>;

function details(value: unknown) {
  if (!value) return {};
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch (error) {
    throw new Error("Stored approval details are corrupt.", { cause: error });
  }
}

function mapApproval(row: Row): Approval {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    runnerApprovalId: String(row.runner_approval_id),
    command: String(row.command),
    details: details(row.details_json),
    status: row.status as Approval["status"],
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export const approvalRepository = {
  create(
    runId: string,
    runnerApprovalId: string,
    command: string,
    approvalDetails: Record<string, unknown>,
  ) {
    const id = randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO approvals
       (id,run_id,runner_approval_id,command,details_json,status,created_at)
       VALUES (?,?,?,?,?,'pending',?)`,
    ).run(
      id,
      runId,
      runnerApprovalId,
      command,
      JSON.stringify(approvalDetails),
      now(),
    );
    return mapApproval(
      db
        .prepare(
          "SELECT * FROM approvals WHERE run_id=? AND runner_approval_id=?",
        )
        .get(runId, runnerApprovalId) as Row,
    );
  },
  get(id: string) {
    const row = db.prepare("SELECT * FROM approvals WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapApproval(row) : null;
  },
  list(status?: Approval["status"]) {
    const rows = status
      ? db
          .prepare(
            "SELECT * FROM approvals WHERE status=? ORDER BY created_at DESC,rowid DESC",
          )
          .all(status)
      : db
          .prepare(
            "SELECT * FROM approvals ORDER BY created_at DESC,rowid DESC",
          )
          .all();
    return (rows as Row[]).map(mapApproval);
  },
  listRecent(limit = 500) {
    return (
      db
        .prepare(
          "SELECT * FROM approvals ORDER BY created_at DESC,rowid DESC LIMIT ?",
        )
        .all(limit) as Row[]
    ).map(mapApproval);
  },
  listForRun(runId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM approvals WHERE run_id=? ORDER BY created_at DESC,rowid DESC",
        )
        .all(runId) as Row[]
    ).map(mapApproval);
  },
  claim(id: string) {
    const result = db
      .prepare(
        "UPDATE approvals SET status='resolving' WHERE id=? AND status='pending'",
      )
      .run(id);
    return result.changes === 1 ? approvalRepository.get(id) : null;
  },
  release(id: string) {
    db.prepare(
      "UPDATE approvals SET status='pending', details_json=json_remove(details_json,'$.runnerDecision') WHERE id=? AND status='resolving'",
    ).run(id);
  },
  recordRunnerDecision(id: string, decision: "approve" | "deny") {
    return (
      db
        .prepare(
          "UPDATE approvals SET details_json=json_set(details_json,'$.runnerDecision',?) WHERE id=? AND status='resolving'",
        )
        .run(decision, id).changes === 1
    );
  },
  resolve(id: string, status: "approved" | "denied") {
    const result = db
      .prepare(
        "UPDATE approvals SET status=?,resolved_at=? WHERE id=? AND status='resolving'",
      )
      .run(status, now(), id);
    return result.changes === 1 ? approvalRepository.get(id) : null;
  },
  closePending(runId: string) {
    return db
      .prepare(
        "UPDATE approvals SET status='denied',resolved_at=? WHERE run_id=? AND status='pending'",
      )
      .run(now(), runId).changes;
  },
  closeOpen(runId: string) {
    return db
      .prepare(
        "UPDATE approvals SET status='denied',resolved_at=? WHERE run_id=? AND status IN ('pending','resolving')",
      )
      .run(now(), runId).changes;
  },
};
