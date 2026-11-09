import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import type { Row } from "@/lib/repositories/repository-helpers";

const text = (value: unknown) => (value == null ? null : String(value));
const count = (sql: string, ...values: unknown[]) =>
  Number((db.prepare(sql).get(...values) as Row).value ?? 0);

export const telegramRepository = {
  recordMessage(chatId: string, messageId: number, kind: string, refId: string | null) {
    db.prepare(
      "INSERT OR IGNORE INTO telegram_messages (id,chat_id,message_id,kind,ref_id,created_at) VALUES (?,?,?,?,?,?)",
    ).run(randomUUID(), chatId, messageId, kind, refId, now());
  },
  wasSent(kind: string, refId: string) {
    return Boolean(db.prepare("SELECT 1 FROM telegram_messages WHERE kind=? AND ref_id=? LIMIT 1").get(kind, refId));
  },
  messageRef(chatId: string, messageId: number) {
    const row = db
      .prepare("SELECT kind, ref_id FROM telegram_messages WHERE chat_id=? AND message_id=?")
      .get(chatId, messageId) as Row | undefined;
    return row ? { kind: String(row.kind), refId: text(row.ref_id) } : null;
  },
  /** Free messages to the lead agent that have no reply yet. */
  listUnansweredChats(chatId: string, limit = 10) {
    return (
      db
        .prepare(
          "SELECT t.message_id, t.ref_id FROM telegram_messages t WHERE t.kind='chat_request' AND t.chat_id=? AND NOT EXISTS (SELECT 1 FROM telegram_messages d WHERE d.kind='chat_reply' AND d.ref_id=t.ref_id) ORDER BY t.created_at LIMIT ?",
        )
        .all(chatId, limit) as Row[]
    ).map((row) => ({ messageId: Number(row.message_id), runId: String(row.ref_id) }));
  },

  // Outbox queries (everything created after the chat was linked)
  pendingApprovals(since: string) {
    return (
      db
        .prepare(
          `SELECT approvals.id, approvals.command, runs.id AS run_id, agents.name AS agent_name
           FROM approvals JOIN runs ON runs.id=approvals.run_id JOIN agents ON agents.id=runs.agent_id
           WHERE approvals.status='pending' AND approvals.created_at >= ? AND NOT EXISTS (SELECT 1 FROM telegram_messages t WHERE t.kind='approval' AND t.ref_id=approvals.id) ORDER BY approvals.created_at LIMIT 20`,
        )
        .all(since) as Row[]
    ).map((row) => ({ id: String(row.id), command: String(row.command), runId: String(row.run_id), agentName: String(row.agent_name) }));
  },
  codingStagesWaiting(since: string) {
    return (
      db
        .prepare(
          `SELECT s.id, s.stage, s.status, s.summary, s.questions_json, s.updated_at, r.number, r.issue_key
           FROM code_run_stages s JOIN code_runs r ON r.id=s.code_run_id
           WHERE s.superseded=0 AND s.status IN ('needs_input','waiting_approval') AND s.updated_at >= ?
             AND r.status IN ('active','waiting','done')
             AND NOT EXISTS (SELECT 1 FROM telegram_messages t WHERE t.kind='coding_stage' AND t.ref_id=s.id || ':' || s.status || ':' || s.updated_at)
           ORDER BY s.updated_at LIMIT 20`,
        )
        .all(since) as Row[]
    ).map((row) => ({
      id: String(row.id),
      stage: String(row.stage),
      status: String(row.status),
      summary: text(row.summary) ?? "",
      questions: (() => {
        try {
          return JSON.parse(String(row.questions_json ?? "[]")) as string[];
        } catch {
          return [];
        }
      })(),
      updatedAt: String(row.updated_at),
      number: Number(row.number),
      issueKey: String(row.issue_key),
    }));
  },
  pullRequestsOpened(since: string) {
    return (
      db
        .prepare(
          `SELECT rr.id, rr.pr_url, rr.pr_number, repo.owner, repo.name, r.issue_key, r.title
           FROM code_run_repositories rr JOIN code_runs r ON r.id=rr.code_run_id
           JOIN code_repositories repo ON repo.id=rr.repository_id
           WHERE rr.pr_url IS NOT NULL AND rr.updated_at >= ? AND NOT EXISTS (SELECT 1 FROM telegram_messages t WHERE t.kind='pull_request' AND t.ref_id=rr.id)
           ORDER BY rr.updated_at LIMIT 20`,
        )
        .all(since) as Row[]
    ).map((row) => ({
      id: String(row.id),
      url: String(row.pr_url),
      number: Number(row.pr_number),
      repository: `${String(row.owner)}/${String(row.name)}`,
      issueKey: String(row.issue_key),
      title: String(row.title),
    }));
  },
  failedRuns(since: string) {
    return (
      db
        .prepare(
          `SELECT runs.id, runs.error, agents.name AS agent_name FROM runs JOIN agents ON agents.id=runs.agent_id
           WHERE runs.status='failed' AND runs.completed_at >= ? AND NOT EXISTS (SELECT 1 FROM telegram_messages t WHERE t.kind='run_failed' AND t.ref_id=runs.id)
           ORDER BY runs.completed_at LIMIT 10`,
        )
        .all(since) as Row[]
    ).map((row) => ({ id: String(row.id), error: text(row.error), agentName: String(row.agent_name) }));
  },
  blockedWork(since: string) {
    return (
      db
        .prepare(
          `SELECT issue_key, COALESCE(remote_updated_at,first_seen_at) AS token FROM work_coordination_items
           WHERE semantic_status='blocked' AND COALESCE(remote_updated_at,first_seen_at) >= ?
             AND NOT EXISTS (SELECT 1 FROM telegram_messages t WHERE t.kind='work_blocked' AND t.ref_id=issue_key || ':' || COALESCE(remote_updated_at,first_seen_at))
           ORDER BY COALESCE(remote_updated_at,first_seen_at) LIMIT 10`,
        )
        .all(since) as Row[]
    ).map((row) => ({ issueKey: String(row.issue_key), token: String(row.token) }));
  },

  /** Numbers for /estado and the daily digest. */
  statusCounts(since: string) {
    return {
      running: count("SELECT COUNT(*) AS value FROM runs WHERE status='running'"),
      queued: count("SELECT COUNT(*) AS value FROM runs WHERE status='queued'"),
      waitingApproval: count("SELECT COUNT(*) AS value FROM runs WHERE status='waiting_approval'"),
      runsSince: count("SELECT COUNT(*) AS value FROM runs WHERE created_at >= ?", since),
      failedSince: count("SELECT COUNT(*) AS value FROM runs WHERE status='failed' AND created_at >= ?", since),
      costMicroUsdSince: count(
        "SELECT COALESCE(SUM(actual_cost_micro_usd),0) AS value FROM run_budget_reservations WHERE created_at >= ?",
        since,
      ),
    };
  },
};
