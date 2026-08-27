import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { assertAutomationTriggerConfiguration } from "@/lib/automation-trigger";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import type {
  Automation,
  EmailAutomationOccurrence,
  InboundEmailEvent,
} from "@/lib/types";

function mapAutomation(row: Row): Automation {
  return {
    id: String(row.id),
    name: String(row.name),
    agentId: String(row.agent_id),
    agentName: row.agent_name ? String(row.agent_name) : undefined,
    triggerType: row.trigger_type === "email" ? "email" : "schedule",
    cronExpression: row.cron_expression ? String(row.cron_expression) : null,
    emailAccountId: row.email_account_id ? String(row.email_account_id) : null,
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

function mapEmailOccurrence(row: Row): EmailAutomationOccurrence {
  const event = JSON.parse(String(row.event_json)) as InboundEmailEvent;
  return {
    automationId: String(row.automation_id),
    inboundEventId: Number(row.inbound_event_id),
    runId: String(row.run_id),
    event,
    status: row.status as EmailAutomationOccurrence["status"],
    skipReason: row.skip_reason ? String(row.skip_reason) : null,
    attemptCount: Number(row.attempt_count ?? 0),
    lastError: row.last_error ? String(row.last_error) : null,
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    createdAt: String(row.created_at),
    dispatchedAt: row.dispatched_at ? String(row.dispatched_at) : null,
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
    triggerType: Automation["triggerType"];
    cronExpression: string | null;
    emailAccountId: string | null;
    prompt: string;
    mode: Automation["mode"];
    enabled: boolean;
  }) {
    assertAutomationTriggerConfiguration(input);
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO automations (id,name,agent_id,trigger_type,cron_expression,email_account_id,prompt,mode,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.agentId,
      input.triggerType,
      input.cronExpression,
      input.emailAccountId,
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
      triggerType: Automation["triggerType"];
      cronExpression: string | null;
      emailAccountId: string | null;
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
    assertAutomationTriggerConfiguration({
      triggerType: input.triggerType ?? current.triggerType,
      cronExpression:
        input.cronExpression === undefined
          ? current.cronExpression
          : input.cronExpression,
      emailAccountId:
        input.emailAccountId === undefined
          ? current.emailAccountId
          : input.emailAccountId,
    });
    db.prepare(
      "UPDATE automations SET name=?,trigger_type=?,cron_expression=?,email_account_id=?,prompt=?,mode=?,enabled=?,last_run_at=?,last_scheduled_for=?,missed_run_policy=?,updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.triggerType ?? current.triggerType,
      input.cronExpression === undefined
        ? current.cronExpression
        : input.cronExpression,
      input.emailAccountId === undefined
        ? current.emailAccountId
        : input.emailAccountId,
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
  getEmailFeedState() {
    const row = db
      .prepare("SELECT * FROM email_automation_feed_state WHERE id='email'")
      .get() as Row | undefined;
    return row
      ? {
          cursor: Number(row.cursor),
          initialized: bool(row.initialized),
          lastPolledAt: row.last_polled_at ? String(row.last_polled_at) : null,
          lastError: row.last_error ? String(row.last_error) : null,
          updatedAt: String(row.updated_at),
        }
      : null;
  },
  recordEmailEventPage(input: {
    expectedCursor: number;
    events: InboundEmailEvent[];
    complete: boolean;
  }) {
    return withImmediateTransaction(() => {
      const timestamp = now();
      db.prepare(
        `INSERT OR IGNORE INTO email_automation_feed_state
         (id,cursor,initialized,last_polled_at,last_error,updated_at)
         VALUES ('email',0,0,NULL,NULL,?)`,
      ).run(timestamp);
      const state = automationRepository.getEmailFeedState()!;
      if (state.cursor !== input.expectedCursor) return false;
      const eligible = db.prepare(
        `SELECT id FROM automations
         WHERE trigger_type='email' AND enabled=1 AND email_account_id=?
           AND created_at<=?`,
      );
      const insert = db.prepare(
        `INSERT OR IGNORE INTO email_automation_occurrences
         (automation_id,inbound_event_id,run_id,event_json,status,created_at)
         VALUES (?,?,?,?,'pending',?)`,
      );
      let nextCursor = input.expectedCursor;
      for (const event of input.events) {
        nextCursor = Math.max(nextCursor, event.id);
        for (const row of eligible.all(
          event.accountId,
          event.discoveredAt,
        ) as Row[]) {
          insert.run(
            String(row.id),
            event.id,
            randomUUID(),
            JSON.stringify(event),
            timestamp,
          );
        }
      }
      return (
        db
          .prepare(
            `UPDATE email_automation_feed_state SET
             cursor=?,initialized=CASE WHEN ? THEN 1 ELSE initialized END,
             last_polled_at=?,last_error=NULL,updated_at=?
           WHERE id='email' AND cursor=?`,
          )
          .run(
            nextCursor,
            input.complete ? 1 : 0,
            timestamp,
            timestamp,
            input.expectedCursor,
          ).changes === 1
      );
    });
  },
  markEmailFeedError(message: string) {
    const timestamp = now();
    db.prepare(
      `INSERT INTO email_automation_feed_state
       (id,cursor,initialized,last_polled_at,last_error,updated_at)
       VALUES ('email',0,0,NULL,?,?)
       ON CONFLICT(id) DO UPDATE SET last_error=excluded.last_error,updated_at=excluded.updated_at`,
    ).run(message.slice(0, 500), timestamp);
  },
  getEmailOccurrence(automationId: string, inboundEventId: number) {
    const row = db
      .prepare(
        `SELECT * FROM email_automation_occurrences
         WHERE automation_id=? AND inbound_event_id=?`,
      )
      .get(automationId, inboundEventId) as Row | undefined;
    return row ? mapEmailOccurrence(row) : null;
  },
  listPendingEmailOccurrences(limit = 100) {
    return (
      db
        .prepare(
          `SELECT * FROM email_automation_occurrences
           WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
           ORDER BY created_at,automation_id,inbound_event_id
           LIMIT ?`,
        )
        .all(now(), limit) as Row[]
    ).map(mapEmailOccurrence);
  },
  getPendingEmailDispatchWarning() {
    const row = db
      .prepare(
        `SELECT o.inbound_event_id,o.last_error,o.next_attempt_at,
                a.id automation_id,a.name automation_name
         FROM email_automation_occurrences o
         JOIN automations a ON a.id=o.automation_id
         WHERE o.status='pending' AND o.last_error IS NOT NULL
         ORDER BY o.next_attempt_at DESC,o.created_at DESC
         LIMIT 1`,
      )
      .get() as Row | undefined;
    return row
      ? {
          automationId: String(row.automation_id),
          automationName: String(row.automation_name),
          inboundEventId: Number(row.inbound_event_id),
          error: String(row.last_error),
          nextAttemptAt: row.next_attempt_at
            ? String(row.next_attempt_at)
            : null,
        }
      : null;
  },
  markEmailOccurrenceDispatched(
    automationId: string,
    inboundEventId: number,
    runId: string,
  ) {
    return db
      .prepare(
        `UPDATE email_automation_occurrences
         SET status='dispatched',dispatched_at=?,skip_reason=NULL,
             last_error=NULL,next_attempt_at=NULL
         WHERE automation_id=? AND inbound_event_id=? AND run_id=? AND status='pending'`,
      )
      .run(now(), automationId, inboundEventId, runId).changes;
  },
  markEmailOccurrenceSkipped(
    automationId: string,
    inboundEventId: number,
    runId: string,
    reason: string,
  ) {
    return db
      .prepare(
        `UPDATE email_automation_occurrences
         SET status='skipped',dispatched_at=?,skip_reason=?,
             last_error=NULL,next_attempt_at=NULL
         WHERE automation_id=? AND inbound_event_id=? AND run_id=? AND status='pending'`,
      )
      .run(now(), reason.slice(0, 500), automationId, inboundEventId, runId)
      .changes;
  },
  markEmailOccurrenceRetry(
    automationId: string,
    inboundEventId: number,
    runId: string,
    message: string,
  ) {
    const occurrence = automationRepository.getEmailOccurrence(
      automationId,
      inboundEventId,
    );
    if (!occurrence || occurrence.status !== "pending") return 0;
    const attemptCount = occurrence.attemptCount + 1;
    const delayMs = Math.min(
      5 * 60_000,
      1_000 * 2 ** Math.min(attemptCount - 1, 8),
    );
    return db
      .prepare(
        `UPDATE email_automation_occurrences
         SET attempt_count=attempt_count+1,last_error=?,next_attempt_at=?
         WHERE automation_id=? AND inbound_event_id=? AND run_id=? AND status='pending'`,
      )
      .run(
        message.slice(0, 500),
        new Date(Date.now() + delayMs).toISOString(),
        automationId,
        inboundEventId,
        runId,
      ).changes;
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
