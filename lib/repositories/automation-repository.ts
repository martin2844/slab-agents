import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { assertAutomationTriggerConfiguration } from "@/lib/automation-trigger";
import { nextScheduledOccurrence } from "@/lib/automation-schedule";
import {
  automationWorkflowStepsSchema,
  persistedAutomationWorkflowStepsSchema,
  defaultEmailWorkflow,
  emailAutomationMatchSchema,
  EMPTY_EMAIL_AUTOMATION_MATCH,
  matchesEmailAutomation,
  normalizePersistedAutomationWorkflowSteps,
  type AutomationWorkflowStep,
  type EmailAutomationMatch,
} from "@/lib/automation-workflow";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import { OperationalError } from "@/lib/operational-error";
import type {
  Automation,
  EmailAutomationOccurrence,
  InboundEmailEvent,
} from "@/lib/types";

const MAX_EMAIL_AUTOMATION_ATTEMPTS = 8;

function nextRunAt(
  lifecycleStatus: Automation["lifecycleStatus"],
  cronExpression: string | null,
  scheduleTimezone: string,
) {
  if (lifecycleStatus !== "enabled" || !cronExpression) return null;
  try {
    return nextScheduledOccurrence(
      cronExpression,
      new Date(),
      scheduleTimezone,
    ).toISOString();
  } catch {
    return null;
  }
}

function mapAutomation(row: Row): Automation {
  const triggerType = row.trigger_type === "email" ? "email" : "schedule";
  const lifecycleStatus = ["draft", "enabled", "paused", "archived"].includes(
    String(row.lifecycle_status),
  )
    ? (String(row.lifecycle_status) as Automation["lifecycleStatus"])
    : bool(row.enabled)
      ? "enabled"
      : "paused";
  const cronExpression = row.cron_expression
    ? String(row.cron_expression)
    : null;
  const scheduleTimezone = row.schedule_timezone
    ? String(row.schedule_timezone)
    : "UTC";
  const emailMatch = row.email_match_json
    ? emailAutomationMatchSchema.parse(JSON.parse(String(row.email_match_json)))
    : EMPTY_EMAIL_AUTOMATION_MATCH;
  const steps =
    triggerType === "email"
      ? row.workflow_steps_json
        ? persistedAutomationWorkflowStepsSchema.parse(
            normalizePersistedAutomationWorkflowSteps(
              JSON.parse(String(row.workflow_steps_json)),
            ),
          )
        : defaultEmailWorkflow({
            automationId: String(row.id),
            agentId: String(row.agent_id),
            prompt: String(row.prompt),
          })
      : [];
  return {
    id: String(row.id),
    name: String(row.name),
    agentId: String(row.agent_id),
    agentName: row.agent_name ? String(row.agent_name) : undefined,
    triggerType,
    cronExpression,
    scheduleTimezone,
    emailAccountId: row.email_account_id ? String(row.email_account_id) : null,
    emailMatch,
    workflowVersion: Number(row.workflow_version ?? 1),
    steps,
    prompt: String(row.prompt),
    mode: row.mode as Automation["mode"],
    enabled: lifecycleStatus === "enabled",
    lifecycleStatus,
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    lastRunStatus: row.last_run_status
      ? (String(row.last_run_status) as Automation["lastRunStatus"])
      : null,
    nextRunAt: nextRunAt(lifecycleStatus, cronExpression, scheduleTimezone),
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
    executionId: row.execution_id ? String(row.execution_id) : null,
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
            (SELECT r.id FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_id,
            (SELECT r.status FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_status
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
          (SELECT r.id FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_id,
          (SELECT r.status FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_status
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
    scheduleTimezone?: string;
    emailAccountId: string | null;
    prompt: string;
    mode: Automation["mode"];
    enabled: boolean;
    lifecycleStatus?: Automation["lifecycleStatus"];
    missedRunPolicy?: Automation["missedRunPolicy"];
    emailMatch?: EmailAutomationMatch;
    steps?: AutomationWorkflowStep[];
  }) {
    assertAutomationTriggerConfiguration(input);
    const id = randomUUID(),
      timestamp = now();
    const lifecycleStatus =
      input.lifecycleStatus ?? (input.enabled ? "enabled" : "paused");
    const emailMatch = emailAutomationMatchSchema.parse(
      input.emailMatch ?? EMPTY_EMAIL_AUTOMATION_MATCH,
    );
    const steps =
      input.triggerType === "email"
        ? automationWorkflowStepsSchema.parse(
            input.steps ??
              defaultEmailWorkflow({
                automationId: id,
                agentId: input.agentId,
                prompt: input.prompt,
              }),
          )
        : [];
    db.prepare(
      "INSERT INTO automations (id,name,agent_id,trigger_type,cron_expression,schedule_timezone,email_account_id,email_match_json,workflow_version,workflow_steps_json,prompt,mode,enabled,lifecycle_status,missed_run_policy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.agentId,
      input.triggerType,
      input.cronExpression,
      input.scheduleTimezone ?? "UTC",
      input.emailAccountId,
      JSON.stringify(emailMatch),
      1,
      input.triggerType === "email" ? JSON.stringify(steps) : null,
      input.prompt,
      input.mode,
      lifecycleStatus === "enabled" ? 1 : 0,
      lifecycleStatus,
      input.missedRunPolicy ?? "latest_once",
      timestamp,
      timestamp,
    );
    return automationRepository.getAutomation(id)!;
  },
  updateAutomation(
    id: string,
    input: Partial<{
      name: string;
      expectedWorkflowVersion: number;
      agentId: string;
      triggerType: Automation["triggerType"];
      cronExpression: string | null;
      scheduleTimezone: string;
      emailAccountId: string | null;
      prompt: string;
      mode: Automation["mode"];
      enabled: boolean;
      lifecycleStatus: Automation["lifecycleStatus"];
      lastRunAt: string | null;
      lastScheduledFor: string | null;
      missedRunPolicy: Automation["missedRunPolicy"];
      emailMatch: EmailAutomationMatch;
      steps: AutomationWorkflowStep[];
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
      emailMatch: input.emailMatch,
      steps: input.steps,
    });
    const nextTriggerType = input.triggerType ?? current.triggerType;
    const emailMatch = emailAutomationMatchSchema.parse(
      input.emailMatch ?? current.emailMatch,
    );
    const workflowChanged =
      input.agentId !== undefined ||
      input.emailAccountId !== undefined ||
      input.prompt !== undefined ||
      input.mode !== undefined ||
      input.emailMatch !== undefined ||
      input.steps !== undefined ||
      input.cronExpression !== undefined ||
      input.scheduleTimezone !== undefined ||
      input.missedRunPolicy !== undefined;
    let steps =
      nextTriggerType === "email"
        ? input.steps
          ? automationWorkflowStepsSchema.parse(input.steps)
          : (workflowChanged
              ? automationWorkflowStepsSchema
              : persistedAutomationWorkflowStepsSchema
            ).parse(
              current.steps.length
                ? current.steps
                : defaultEmailWorkflow({
                    automationId: current.id,
                    agentId: current.agentId,
                    prompt: current.prompt,
                  }),
            )
        : [];
    if (nextTriggerType === "email" && !input.steps && steps[0]) {
      steps = automationWorkflowStepsSchema.parse([
        {
          ...steps[0],
          ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
          ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        },
        ...steps.slice(1),
      ]);
    }
    const nextAgentId = input.agentId ?? current.agentId;
    if (nextTriggerType === "email" && steps[0]?.agentId !== nextAgentId) {
      throw new OperationalError(
        "The first workflow step must use the automation agent.",
        "INVALID_AUTOMATION_TRIGGER",
      );
    }
    const nextPrompt =
      nextTriggerType === "email"
        ? steps[0]!.prompt
        : (input.prompt ?? current.prompt);
    const nextLifecycleStatus =
      input.lifecycleStatus ??
      (input.enabled === undefined
        ? current.lifecycleStatus
        : input.enabled
          ? "enabled"
          : "paused");
    const values = [
      input.name ?? current.name,
      nextAgentId,
      input.triggerType ?? current.triggerType,
      input.cronExpression === undefined
        ? current.cronExpression
        : input.cronExpression,
      input.scheduleTimezone ?? current.scheduleTimezone,
      input.emailAccountId === undefined
        ? current.emailAccountId
        : input.emailAccountId,
      JSON.stringify(emailMatch),
      workflowChanged ? 1 : 0,
      nextTriggerType === "email" ? JSON.stringify(steps) : null,
      nextPrompt,
      input.mode ?? current.mode,
      nextLifecycleStatus === "enabled" ? 1 : 0,
      nextLifecycleStatus,
      input.lastRunAt === undefined ? current.lastRunAt : input.lastRunAt,
      input.lastScheduledFor === undefined
        ? current.lastScheduledFor
        : input.lastScheduledFor,
      input.missedRunPolicy ?? current.missedRunPolicy,
      now(),
      id,
    ];
    const updated = db
      .prepare(
        `UPDATE automations SET name=?,agent_id=?,trigger_type=?,cron_expression=?,schedule_timezone=?,email_account_id=?,email_match_json=?,workflow_version=workflow_version+?,workflow_steps_json=?,prompt=?,mode=?,enabled=?,lifecycle_status=?,last_run_at=?,last_scheduled_for=?,missed_run_policy=?,updated_at=?
         WHERE id=?${input.expectedWorkflowVersion === undefined ? "" : " AND workflow_version=?"}`,
      )
      .run(
        ...values,
        ...(input.expectedWorkflowVersion === undefined
          ? []
          : [input.expectedWorkflowVersion]),
      );
    if (updated.changes !== 1 && input.expectedWorkflowVersion !== undefined) {
      throw new OperationalError(
        "Workflow changed while you were editing. Reloaded the latest version; review it before saving again.",
        "AUTOMATION_VERSION_CONFLICT",
        409,
      );
    }
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
        `SELECT id,email_match_json FROM automations
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
          const match = emailAutomationMatchSchema.parse(
            JSON.parse(String(row.email_match_json)),
          );
          if (!matchesEmailAutomation(match, event)) continue;
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
          `WITH ready AS (
             SELECT *,ROW_NUMBER() OVER (
               PARTITION BY CASE WHEN attempt_count=0 THEN 0 ELSE 1 END
               ORDER BY COALESCE(next_attempt_at,created_at),created_at,
                        automation_id,inbound_event_id
             ) lane_position
             FROM email_automation_occurrences
             WHERE status='pending'
               AND (next_attempt_at IS NULL OR next_attempt_at<=?)
           )
           SELECT * FROM ready
           ORDER BY lane_position,
                    CASE WHEN attempt_count=0 THEN 0 ELSE 1 END,
                    automation_id,inbound_event_id
           LIMIT ?`,
        )
        .all(now(), limit) as Row[]
    ).map(mapEmailOccurrence);
  },
  getEmailDispatchWarning() {
    const row = db
      .prepare(
        `SELECT o.inbound_event_id,o.status,o.last_error,o.next_attempt_at,
                a.id automation_id,a.name automation_name
         FROM email_automation_occurrences o
         JOIN automations a ON a.id=o.automation_id
         WHERE o.status IN ('pending','skipped') AND o.last_error IS NOT NULL
         ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END,
                  o.next_attempt_at DESC,o.created_at DESC
         LIMIT 1`,
      )
      .get() as Row | undefined;
    return row
      ? {
          automationId: String(row.automation_id),
          automationName: String(row.automation_name),
          inboundEventId: Number(row.inbound_event_id),
          status: row.status === "pending" ? "pending" : "failed",
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
    const row = db
      .prepare(
        `SELECT error_attempt_count FROM email_automation_occurrences
         WHERE automation_id=? AND inbound_event_id=? AND run_id=? AND status='pending'`,
      )
      .get(automationId, inboundEventId, runId) as Row | undefined;
    if (!row) return 0;
    const errorAttemptCount = Number(row.error_attempt_count ?? 0) + 1;
    if (errorAttemptCount >= MAX_EMAIL_AUTOMATION_ATTEMPTS) {
      return db
        .prepare(
          `UPDATE email_automation_occurrences
           SET status='skipped',attempt_count=attempt_count+1,
               error_attempt_count=error_attempt_count+1,last_error=?,
               next_attempt_at=NULL,skip_reason='retry_limit_exceeded',
               dispatched_at=?
           WHERE automation_id=? AND inbound_event_id=? AND run_id=?
             AND status='pending'`,
        )
        .run(message.slice(0, 500), now(), automationId, inboundEventId, runId)
        .changes;
    }
    const delayMs = Math.min(
      5 * 60_000,
      1_000 * 2 ** Math.min(errorAttemptCount - 1, 8),
    );
    return db
      .prepare(
        `UPDATE email_automation_occurrences
         SET attempt_count=attempt_count+1,
             error_attempt_count=error_attempt_count+1,
             last_error=?,next_attempt_at=?
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
  deferEmailOccurrence(
    automationId: string,
    inboundEventId: number,
    runId: string,
    delayMs = 30_000,
  ) {
    return db
      .prepare(
        `UPDATE email_automation_occurrences
         SET attempt_count=attempt_count+1,next_attempt_at=?,last_error=NULL
         WHERE automation_id=? AND inbound_event_id=? AND run_id=?
           AND status='pending'`,
      )
      .run(
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
