import "server-only";

import { db, now } from "@/lib/db/database";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { bool, json, type Row } from "@/lib/repositories/repository-helpers";
import type {
  SystemUpdateAction,
  SystemUpdateChannel,
  SystemUpdateCheckResult,
  SystemUpdatePolicy,
  SystemUpdateRequest,
  SystemUpdateRequestState,
} from "@/lib/types";

type NewRequest = {
  id: string;
  action: SystemUpdateAction;
  channel: SystemUpdateChannel;
  target: string | null;
  source: SystemUpdateRequest["source"];
  requestedAt: string;
  expiresAt: string;
  parentRequestId?: string | null;
  scheduledFor?: string | null;
};

function mapPolicy(row: Row): SystemUpdatePolicy {
  return {
    version: Number(row.policy_version),
    enabled: bool(row.enabled),
    checkHourUtc: Number(row.check_hour_utc),
    lastScheduledAt: row.last_scheduled_at
      ? String(row.last_scheduled_at)
      : null,
    updatedAt: String(row.updated_at),
  };
}

function mapRequest(row: Row): SystemUpdateRequest {
  const result = json<SystemUpdateCheckResult | null>(row.result_json, null);
  return {
    id: String(row.id),
    action: row.action as SystemUpdateAction,
    channel: row.channel as SystemUpdateChannel,
    target: row.target ? String(row.target) : null,
    source: row.source as SystemUpdateRequest["source"],
    state: row.state as SystemUpdateRequestState,
    requestedAt: String(row.requested_at),
    expiresAt: String(row.expires_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    result,
    error: row.error_code
      ? {
          code: String(row.error_code),
          message: String(row.error_message ?? "The update request failed."),
        }
      : null,
    automaticDecision: row.automatic_decision
      ? (String(
          row.automatic_decision,
        ) as SystemUpdateRequest["automaticDecision"])
      : null,
    scheduledFor: row.scheduled_for ? String(row.scheduled_for) : null,
    parentRequestId: row.parent_request_id
      ? String(row.parent_request_id)
      : null,
    followUpRequestId: row.follow_up_request_id
      ? String(row.follow_up_request_id)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function insertRequest(input: NewRequest, timestamp: string) {
  db.prepare(
    `INSERT INTO system_update_requests
     (id,action,channel,target,source,state,requested_at,expires_at,
      parent_request_id,scheduled_for,created_at,updated_at)
     VALUES (?,?,?,?,?,'submitted',?,?,?,?,?,?)`,
  ).run(
    input.id,
    input.action,
    input.channel,
    input.target,
    input.source,
    input.requestedAt,
    input.expiresAt,
    input.parentRequestId ?? null,
    input.scheduledFor ?? null,
    timestamp,
    timestamp,
  );
}

export const systemUpdateRepository = {
  getPolicy() {
    const row = db
      .prepare("SELECT * FROM system_update_policies WHERE id=1")
      .get() as Row | undefined;
    if (!row) throw new Error("System update policy is missing.");
    return mapPolicy(row);
  },

  updatePolicy(input: {
    expectedVersion: number;
    enabled: boolean;
    checkHourUtc: number;
  }) {
    const timestamp = now();
    const changed = db
      .prepare(
        `UPDATE system_update_policies
         SET enabled=?,check_hour_utc=?,policy_version=policy_version+1,updated_at=?
         WHERE id=1 AND policy_version=?`,
      )
      .run(
        input.enabled ? 1 : 0,
        input.checkHourUtc,
        timestamp,
        input.expectedVersion,
      ).changes;
    return changed === 1 ? systemUpdateRepository.getPolicy() : null;
  },

  getRequest(id: string) {
    const row = db
      .prepare("SELECT * FROM system_update_requests WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapRequest(row) : null;
  },

  listRequests(limit = 30) {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return (
      db
        .prepare(
          `SELECT * FROM system_update_requests
           ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(boundedLimit) as Row[]
    ).map(mapRequest);
  },

  listReconcileCandidates() {
    return (
      db
        .prepare(
          `SELECT * FROM system_update_requests
           WHERE state IN ('submitted','running')
           ORDER BY created_at,id`,
        )
        .all() as Row[]
    ).map(mapRequest);
  },

  getLatestInventory(channel?: SystemUpdateChannel) {
    const row = (
      channel
        ? db
            .prepare(
              `SELECT * FROM system_update_requests
             WHERE state='succeeded' AND channel=?
               AND result_json IS NOT NULL
             ORDER BY completed_at DESC,created_at DESC LIMIT 1`,
            )
            .get(channel)
        : db
            .prepare(
              `SELECT * FROM system_update_requests
             WHERE state='succeeded'
               AND result_json IS NOT NULL
             ORDER BY completed_at DESC,created_at DESC LIMIT 1`,
            )
            .get()
    ) as Row | undefined;
    return row ? mapRequest(row) : null;
  },

  getLatestSuccessfulCheck(channel: SystemUpdateChannel) {
    const row = db
      .prepare(
        `SELECT * FROM system_update_requests
         WHERE action='check' AND state='succeeded' AND channel=?
           AND result_json IS NOT NULL
         ORDER BY completed_at DESC,created_at DESC,id DESC LIMIT 1`,
      )
      .get(channel) as Row | undefined;
    return row ? mapRequest(row) : null;
  },

  getLatestApply(channel: SystemUpdateChannel) {
    const row = db
      .prepare(
        `SELECT * FROM system_update_requests
         WHERE action='apply' AND channel=?
         ORDER BY created_at DESC,id DESC LIMIT 1`,
      )
      .get(channel) as Row | undefined;
    return row ? mapRequest(row) : null;
  },

  getScheduledCheckAwaitingDecision() {
    const row = db
      .prepare(
        `SELECT * FROM system_update_requests
         WHERE source='scheduled' AND action='check' AND state='succeeded'
           AND automatic_decision IS NULL AND follow_up_request_id IS NULL
           AND result_json IS NOT NULL
         ORDER BY completed_at,created_at LIMIT 1`,
      )
      .get() as Row | undefined;
    return row ? mapRequest(row) : null;
  },

  createManualRequest(input: NewRequest) {
    return withImmediateTransaction(() => {
      const active = db
        .prepare(
          `SELECT 1 FROM system_update_requests
           WHERE state IN ('submitted','running') LIMIT 1`,
        )
        .get();
      if (active) return null;
      const timestamp = now();
      insertRequest(input, timestamp);
      return systemUpdateRepository.getRequest(input.id)!;
    });
  },

  createScheduledCheckIfDue(input: NewRequest & { scheduledFor: string }) {
    return withImmediateTransaction(() => {
      const policy = systemUpdateRepository.getPolicy();
      if (
        !policy.enabled ||
        (policy.lastScheduledAt && policy.lastScheduledAt >= input.scheduledFor)
      ) {
        return null;
      }
      const active = db
        .prepare(
          `SELECT 1 FROM system_update_requests
           WHERE state IN ('submitted','running') LIMIT 1`,
        )
        .get();
      if (active) return null;
      const priorAttempts = db
        .prepare(
          `SELECT requested_at FROM system_update_requests
           WHERE source='scheduled' AND action='check' AND scheduled_for=?
           ORDER BY requested_at DESC,id DESC`,
        )
        .all(input.scheduledFor) as Array<{ requested_at: string }>;
      const latestAttempt = priorAttempts[0];
      if (latestAttempt) {
        const exponent = Math.min(priorAttempts.length - 1, 6);
        const retryDelayMs = Math.min(
          6 * 60 * 60_000,
          5 * 60_000 * 2 ** exponent,
        );
        if (
          Date.parse(input.requestedAt) <
          Date.parse(latestAttempt.requested_at) + retryDelayMs
        ) {
          return null;
        }
      }
      const timestamp = now();
      insertRequest(input, timestamp);
      return systemUpdateRepository.getRequest(input.id)!;
    });
  },

  markScheduledOccurrencePublished(id: string, scheduledFor: string) {
    return withImmediateTransaction(() => {
      const request = db
        .prepare(
          `SELECT 1 FROM system_update_requests
           WHERE id=? AND source='scheduled' AND action='check'
             AND scheduled_for=?`,
        )
        .get(id, scheduledFor);
      if (!request) return false;
      const policy = systemUpdateRepository.getPolicy();
      if (policy.lastScheduledAt && policy.lastScheduledAt >= scheduledFor) {
        return true;
      }
      db.prepare(
        `UPDATE system_update_policies
         SET last_scheduled_at=?,updated_at=? WHERE id=1`,
      ).run(scheduledFor, now());
      return true;
    });
  },

  createAutomaticApply(checkId: string, input: NewRequest) {
    return withImmediateTransaction(() => {
      if (!systemUpdateRepository.getPolicy().enabled) return null;
      const parent = db
        .prepare(
          `SELECT 1 FROM system_update_requests
           WHERE id=? AND source='scheduled' AND action='check'
             AND state='succeeded' AND automatic_decision IS NULL
             AND follow_up_request_id IS NULL`,
        )
        .get(checkId);
      if (!parent) return null;
      const active = db
        .prepare(
          `SELECT 1 FROM system_update_requests
           WHERE state IN ('submitted','running') LIMIT 1`,
        )
        .get();
      if (active) return null;
      const timestamp = now();
      insertRequest({ ...input, parentRequestId: checkId }, timestamp);
      const changed = db
        .prepare(
          `UPDATE system_update_requests
           SET automatic_decision='apply_submitted',follow_up_request_id=?,updated_at=?
           WHERE id=? AND automatic_decision IS NULL
             AND follow_up_request_id IS NULL`,
        )
        .run(input.id, timestamp, checkId).changes;
      if (changed !== 1) throw new Error("Automatic update claim was lost.");
      return systemUpdateRepository.getRequest(input.id)!;
    });
  },

  markAutomaticDecision(
    id: string,
    decision: Exclude<
      SystemUpdateRequest["automaticDecision"],
      "apply_submitted" | null
    >,
  ) {
    return db
      .prepare(
        `UPDATE system_update_requests
         SET automatic_decision=?,updated_at=?
         WHERE id=? AND automatic_decision IS NULL`,
      )
      .run(decision, now(), id).changes;
  },

  updateFromBridgeStatus(input: {
    id: string;
    state: "running" | "succeeded" | "failed";
    startedAt: string;
    completedAt: string | null;
    result: SystemUpdateCheckResult | null;
    error: { code: string; message: string } | null;
  }) {
    const current = systemUpdateRepository.getRequest(input.id);
    if (!current || ["succeeded", "failed"].includes(current.state)) {
      return current;
    }
    db.prepare(
      `UPDATE system_update_requests SET
       state=?,started_at=?,completed_at=?,result_json=?,error_code=?,
       error_message=?,updated_at=? WHERE id=? AND state IN ('submitted','running')`,
    ).run(
      input.state,
      input.startedAt,
      input.completedAt,
      input.result ? JSON.stringify(input.result) : null,
      input.error?.code ?? null,
      input.error?.message.slice(0, 500) ?? null,
      now(),
      input.id,
    );
    return systemUpdateRepository.getRequest(input.id);
  },

  markFailed(id: string, code: string, message: string, completedAt: string) {
    db.prepare(
      `UPDATE system_update_requests SET
       state='failed',completed_at=?,error_code=?,error_message=?,updated_at=?
       WHERE id=? AND state IN ('submitted','running')`,
    ).run(completedAt, code, message.slice(0, 500), now(), id);
    return systemUpdateRepository.getRequest(id);
  },
};
