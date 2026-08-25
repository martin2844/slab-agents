import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";

type CoordinationTrigger =
  | "assignment"
  | "resumed"
  | "review_requested"
  | "blocked"
  | "mention";

const CLAIM_STALE_AFTER_MS = 5 * 60_000;

export const workCoordinationStore = {
  getItem(issueKey: string) {
    return db
      .prepare("SELECT * FROM work_coordination_items WHERE issue_key=?")
      .get(issueKey) as Record<string, unknown> | undefined;
  },
  observeItem(input: {
    issueKey: string;
    projectKey: string;
    assignee: string | null;
    semanticStatus: string;
    remoteUpdatedAt: string | null;
    labels: string[];
  }) {
    const timestamp = now();
    db.prepare(
      `INSERT INTO work_coordination_items
        (issue_key,project_key,assignee,semantic_status,remote_updated_at,labels_json,first_seen_at,last_seen_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(issue_key) DO UPDATE SET
        project_key=excluded.project_key,
        assignee=excluded.assignee,
        semantic_status=excluded.semantic_status,
        remote_updated_at=excluded.remote_updated_at,
        labels_json=excluded.labels_json,
        last_seen_at=excluded.last_seen_at`,
    ).run(
      input.issueKey,
      input.projectKey,
      input.assignee,
      input.semanticStatus,
      input.remoteUpdatedAt,
      JSON.stringify(input.labels),
      timestamp,
      timestamp,
    );
  },
  claimEvent(input: {
    dedupeKey: string;
    issueKey: string;
    type: CoordinationTrigger;
    agentId: string;
    commentId?: string | null;
  }) {
    const id = randomUUID();
    const timestamp = now();
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO work_coordination_events
          (id,dedupe_key,issue_key,type,agent_id,comment_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.dedupeKey,
        input.issueKey,
        input.type,
        input.agentId,
        input.commentId ?? null,
        timestamp,
        timestamp,
      );
    if (result.changes > 0) return id;

    const staleBefore = new Date(
      Date.now() - CLAIM_STALE_AFTER_MS,
    ).toISOString();
    const retry = db
      .prepare(
        `UPDATE work_coordination_events
         SET error=NULL,updated_at=?
         WHERE dedupe_key=? AND run_id IS NULL
           AND (error IS NOT NULL OR updated_at < ?)`,
      )
      .run(timestamp, input.dedupeKey, staleBefore);
    if (retry.changes !== 1) return null;
    const existing = db
      .prepare("SELECT id FROM work_coordination_events WHERE dedupe_key=?")
      .get(input.dedupeKey) as { id: string } | undefined;
    return existing?.id ?? null;
  },
  completeEvent(id: string, runId: string) {
    db.prepare(
      "UPDATE work_coordination_events SET run_id=?,error=NULL,updated_at=? WHERE id=?",
    ).run(runId, now(), id);
  },
  hasSeenComment(commentId: string) {
    return Boolean(
      db
        .prepare(
          "SELECT comment_id FROM work_coordination_comments WHERE comment_id=?",
        )
        .get(commentId),
    );
  },
  rememberComment(issueKey: string, commentId: string) {
    return (
      db
        .prepare(
          "INSERT OR IGNORE INTO work_coordination_comments (comment_id,issue_key,first_seen_at) VALUES (?,?,?)",
        )
        .run(commentId, issueKey, now()).changes > 0
    );
  },
};
