import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import type {
  OperatorNotificationDelivery,
  OperatorNotificationKind,
  OperatorNotificationSettings,
} from "@/lib/types";

function mapSettings(row: Row): OperatorNotificationSettings {
  return {
    enabled: bool(row.enabled),
    enabledAt: row.enabled_at ? String(row.enabled_at) : null,
    recipientEmail: String(row.recipient_email ?? ""),
    accountId: row.account_id ? String(row.account_id) : null,
    profileId: row.profile_id ? String(row.profile_id) : null,
    tokenId: row.token_id ? String(row.token_id) : null,
    tokenPrefix: row.token_prefix ? String(row.token_prefix) : null,
    tokenCreatedAt: row.token_created_at ? String(row.token_created_at) : null,
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapDelivery(row: Row): OperatorNotificationDelivery {
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    kind: row.kind as OperatorNotificationKind,
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    subject: String(row.subject),
    body: String(row.body),
    status: row.status as OperatorNotificationDelivery["status"],
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: String(row.next_attempt_at),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    sentAt: row.sent_at ? String(row.sent_at) : null,
  };
}

export const operatorNotificationRepository = {
  getSettings() {
    const row = db
      .prepare("SELECT * FROM operator_notification_settings WHERE id=1")
      .get() as Row | undefined;
    if (!row) throw new Error("Operator notification settings are missing.");
    return mapSettings(row);
  },

  saveSettings(input: {
    enabled: boolean;
    recipientEmail: string;
    accountId: string | null;
    profileId: string | null;
    tokenId: string | null;
    tokenPrefix: string | null;
    tokenCreatedAt: string | null;
    lastTestedAt?: string | null;
    lastError?: string | null;
  }) {
    db.prepare(
      `UPDATE operator_notification_settings SET
       enabled=?,enabled_at=CASE
         WHEN ?=1 AND enabled=0 THEN ?
         WHEN ?=0 THEN NULL
         ELSE enabled_at END,
       recipient_email=?,account_id=?,profile_id=?,token_id=?,
       token_prefix=?,token_created_at=?,last_tested_at=COALESCE(?,last_tested_at),
       last_error=?,updated_at=? WHERE id=1`,
    ).run(
      Number(input.enabled),
      Number(input.enabled),
      now(),
      Number(input.enabled),
      input.recipientEmail,
      input.accountId,
      input.profileId,
      input.tokenId,
      input.tokenPrefix,
      input.tokenCreatedAt,
      input.lastTestedAt ?? null,
      input.lastError ?? null,
      now(),
    );
    if (!input.enabled) {
      db.prepare(
        "UPDATE operator_notification_outbox SET status='cancelled',last_error='Notifications disabled' WHERE status IN ('pending','sending')",
      ).run();
    }
    return operatorNotificationRepository.getSettings();
  },

  recordTest(result: { testedAt: string; error: string | null }) {
    db.prepare(
      "UPDATE operator_notification_settings SET last_tested_at=?,last_error=?,updated_at=? WHERE id=1",
    ).run(result.testedAt, result.error, now());
    return operatorNotificationRepository.getSettings();
  },

  enqueue(input: {
    dedupeKey: string;
    kind: OperatorNotificationKind;
    resourceType: string;
    resourceId: string;
    subject: string;
    body: string;
  }) {
    const id = randomUUID();
    const timestamp = now();
    const inserted = db.prepare(
      `INSERT OR IGNORE INTO operator_notification_outbox
       (id,dedupe_key,kind,resource_type,resource_id,subject,body,status,
        attempt_count,next_attempt_at,created_at)
       VALUES (?,?,?,?,?,?,?,'pending',0,?,?)`,
    ).run(
      id,
      input.dedupeKey,
      input.kind,
      input.resourceType,
      input.resourceId,
      input.subject.slice(0, 300),
      input.body.slice(0, 10_000),
      timestamp,
      timestamp,
    );
    if (inserted.changes !== 1) return null;
    return operatorNotificationRepository.getDelivery(id);
  },

  getDelivery(id: string) {
    const row = db
      .prepare("SELECT * FROM operator_notification_outbox WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapDelivery(row) : null;
  },

  listDue(limit = 20) {
    return (
      db.prepare(
        `SELECT * FROM operator_notification_outbox
         WHERE status='pending' AND next_attempt_at <= ?
         ORDER BY created_at,id LIMIT ?`,
      ).all(now(), Math.max(1, Math.min(100, Math.trunc(limit)))) as Row[]
    ).map(mapDelivery);
  },

  claim(id: string) {
    const timestamp = now();
    const changed = db.prepare(
      `UPDATE operator_notification_outbox
       SET status='sending',attempt_count=attempt_count+1,claimed_at=?
       WHERE id=? AND status='pending' AND next_attempt_at <= ?`,
    ).run(timestamp, id, timestamp).changes;
    return changed === 1 ? operatorNotificationRepository.getDelivery(id) : null;
  },

  recoverStaleClaims(staleBefore: string) {
    return db.prepare(
      `UPDATE operator_notification_outbox
       SET status='pending',claimed_at=NULL,last_error='Delivery worker was interrupted'
       WHERE status='sending' AND claimed_at <= ?`,
    ).run(staleBefore).changes;
  },

  markSent(id: string) {
    const timestamp = now();
    db.prepare(
      "UPDATE operator_notification_outbox SET status='sent',sent_at=?,claimed_at=NULL,last_error=NULL WHERE id=? AND status='sending'",
    ).run(timestamp, id);
    return operatorNotificationRepository.getDelivery(id);
  },

  markCancelled(id: string, reason: string) {
    db.prepare(
      "UPDATE operator_notification_outbox SET status='cancelled',claimed_at=NULL,last_error=? WHERE id=? AND status='sending'",
    ).run(reason.slice(0, 500), id);
    return operatorNotificationRepository.getDelivery(id);
  },

  markFailed(id: string, error: string, retryAt: string | null) {
    db.prepare(
      `UPDATE operator_notification_outbox SET status=?,next_attempt_at=?,claimed_at=NULL,last_error=?
       WHERE id=? AND status='sending'`,
    ).run(
      retryAt ? "pending" : "failed",
      retryAt ?? now(),
      error.slice(0, 500),
      id,
    );
    return operatorNotificationRepository.getDelivery(id);
  },

  listRecent(limit = 20) {
    return (
      db.prepare(
        "SELECT * FROM operator_notification_outbox ORDER BY created_at DESC,id DESC LIMIT ?",
      ).all(Math.max(1, Math.min(100, Math.trunc(limit)))) as Row[]
    ).map(mapDelivery);
  },

  isStillActionable(delivery: OperatorNotificationDelivery) {
    if (delivery.kind === "approval_waiting") {
      return Boolean(
        db.prepare("SELECT 1 FROM approvals WHERE id=? AND status='pending'").get(
          delivery.resourceId,
        ),
      );
    }
    if (delivery.kind === "run_failed") {
      return Boolean(
        db.prepare("SELECT 1 FROM runs WHERE id=? AND status='failed'").get(
          delivery.resourceId,
        ),
      );
    }
    if (delivery.kind === "work_blocked") {
      return Boolean(
        db.prepare(
          "SELECT 1 FROM work_coordination_items WHERE issue_key=? AND semantic_status='blocked'",
        ).get(delivery.resourceId),
      );
    }
    if (delivery.kind === "integration_unhealthy") {
      return Boolean(
        db.prepare(
          `SELECT 1 FROM integrations WHERE id=? AND enabled=1 AND status='failed'
           UNION ALL
           SELECT 1 FROM email_integrations WHERE id=? AND status='failed'
           LIMIT 1`,
        ).get(delivery.resourceId, delivery.resourceId),
      );
    }
    return Boolean(
      db.prepare(
        "SELECT 1 FROM system_update_requests WHERE id=? AND state='failed'",
      ).get(delivery.resourceId),
    );
  },

  listAttentionCandidates(since: string) {
    const approvals = db.prepare(
      `SELECT approvals.id,approvals.command,approvals.created_at,
              runs.id AS run_id,agents.name AS agent_name
       FROM approvals
       JOIN runs ON runs.id=approvals.run_id
       JOIN agents ON agents.id=runs.agent_id
       WHERE approvals.status='pending' AND approvals.created_at >= ?`,
    ).all(since) as Row[];
    const failedRuns = db.prepare(
      `SELECT runs.id,runs.error,runs.completed_at,runs.automation_id,
              agents.name AS agent_name
       FROM runs JOIN agents ON agents.id=runs.agent_id
       WHERE runs.status='failed' AND runs.completed_at >= ?`,
    ).all(since) as Row[];
    const blockedWork = db.prepare(
      `SELECT issue_key,COALESCE(remote_updated_at,first_seen_at) AS state_token
       FROM work_coordination_items
       WHERE semantic_status='blocked'
         AND COALESCE(remote_updated_at,first_seen_at) >= ?`,
    ).all(since) as Row[];
    const integrations = db.prepare(
      `SELECT id,name,status,updated_at FROM integrations
       WHERE enabled=1 AND status='failed' AND updated_at >= ?`,
    ).all(since) as Row[];
    const emailIntegrations = db.prepare(
      `SELECT id,'Email' AS name,status,updated_at FROM email_integrations
       WHERE status='failed' AND updated_at >= ?`,
    ).all(since) as Row[];
    const updates = db.prepare(
      `SELECT id,action,error_code,error_message,completed_at
       FROM system_update_requests
       WHERE state='failed' AND completed_at >= ?`,
    ).all(since) as Row[];
    return { approvals, failedRuns, blockedWork, integrations, emailIntegrations, updates };
  },
};
