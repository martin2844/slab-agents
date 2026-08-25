import "server-only";

import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

type Database = BetterSqlite3.Database;
type Row = Record<string, unknown>;

const TERMINAL = new Set(["completed", "failed", "skipped", "cancelled"]);

export type RunLease = {
  runId: string;
  ownerId: string;
  isCurrent: () => boolean;
  begin: () => "started" | "maintenance" | "lost";
  release: () => void;
};

export type DurableAdmission = {
  queued: boolean;
  blockedByRunId: string | null;
  reason: "active_run" | "fifo" | "maintenance" | null;
  ready: Promise<RunLease | null>;
};

export type RunRecovery = {
  requeued: string[];
  failed: string[];
  releasedQueued: string[];
};

type QueueOptions = {
  ownerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  maxAttempts?: number;
  now?: () => Date;
};

type ClaimResult = {
  claimed: boolean;
  terminal: boolean;
  blockedByRunId: string | null;
  reason: DurableAdmission["reason"];
};

export class RunQueueRepository {
  readonly ownerId: string;
  private readonly database: Database;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private readonly maxAttempts: number;
  private readonly clock: () => Date;
  private readonly heartbeats = new Map<string, NodeJS.Timeout>();

  constructor(database: Database, options: QueueOptions = {}) {
    this.database = database;
    this.ownerId = options.ownerId ?? randomUUID();
    this.leaseMs = options.leaseMs ?? 60_000;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.pollMs = options.pollMs ?? 250;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.clock = options.now ?? (() => new Date());
  }

  acquire(runId: string): DurableAdmission {
    const initial = this.tryClaim(runId);
    if (initial.claimed) {
      return {
        queued: false,
        blockedByRunId: null,
        reason: null,
        ready: Promise.resolve(this.startLease(runId)),
      };
    }
    if (initial.terminal) {
      return {
        queued: false,
        blockedByRunId: null,
        reason: null,
        ready: Promise.resolve(null),
      };
    }

    return {
      queued: true,
      blockedByRunId: initial.blockedByRunId,
      reason: initial.reason,
      ready: this.waitForLease(runId),
    };
  }

  recoverExpired(): RunRecovery {
    const timestamp = this.clock().toISOString();
    const recover = this.database.transaction(() => {
      const releasedQueued = (
        this.database
          .prepare(
            `SELECT id FROM runs
             WHERE status='queued' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
          )
          .all(timestamp) as Row[]
      ).map((row) => String(row.id));
      if (releasedQueued.length) {
        this.database
          .prepare(
            `UPDATE runs SET lease_owner=NULL,lease_expires_at=NULL
             WHERE status='queued' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
          )
          .run(timestamp);
      }

      const abandoned = this.database
        .prepare(
          `SELECT id,status,attempt_count,runner_run_id FROM runs
           WHERE status IN ('running','waiting_approval')
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY rowid`,
        )
        .all(timestamp) as Row[];
      const requeued: string[] = [];
      const failed: string[] = [];
      for (const row of abandoned) {
        const id = String(row.id);
        const status = String(row.status);
        const attempts = Number(row.attempt_count ?? 0);
        const hasRunnerIdentity = Boolean(row.runner_run_id);
        if (
          hasRunnerIdentity ||
          (status === "running" && attempts < this.maxAttempts)
        ) {
          this.database
            .prepare(
              `UPDATE runs
               SET status='queued',started_at=NULL,completed_at=NULL,error=NULL,
                   lease_owner=NULL,lease_expires_at=NULL,runner_retry_at=NULL
               WHERE id=?`,
            )
            .run(id);
          requeued.push(id);
          continue;
        }
        const message =
          status === "waiting_approval"
            ? "Runtime stopped while waiting for approval. Start a new run to retry."
            : `Runtime lease expired after ${attempts} attempts.`;
        this.database
          .prepare(
            `UPDATE runs
             SET status='failed',completed_at=?,error=?,lease_owner=NULL,lease_expires_at=NULL
             WHERE id=?`,
          )
          .run(timestamp, message, id);
        failed.push(id);
      }
      return { requeued, failed, releasedQueued };
    });
    return recover.immediate();
  }

  listQueuedRunIds(limit = 100, directDispatchGraceMs = 2_000) {
    const readyBefore = new Date(
      this.clock().getTime() - directDispatchGraceMs,
    ).toISOString();
    return (
      this.database
        .prepare(
          `SELECT id FROM runs
           WHERE status='queued' AND COALESCE(created_at,queued_at) <= ?
             AND (runner_retry_at IS NULL OR runner_retry_at <= ?)
           ORDER BY COALESCE(queued_at,created_at),rowid
           LIMIT ?`,
        )
        .all(readyBefore, this.clock().toISOString(), limit) as Row[]
    ).map((row) => String(row.id));
  }

  maintenanceEnabled() {
    const row = this.database
      .prepare("SELECT value FROM settings WHERE key='system_maintenance_mode'")
      .get() as { value?: unknown } | undefined;
    return row?.value === "on";
  }

  private waitForLease(runId: string): Promise<RunLease | null> {
    return new Promise((resolve) => {
      const poll = () => {
        const result = this.tryClaim(runId);
        if (result.claimed) {
          resolve(this.startLease(runId));
          return;
        }
        if (result.terminal) {
          resolve(null);
          return;
        }
        setTimeout(poll, this.pollMs);
      };
      poll();
    });
  }

  private tryClaim(runId: string): ClaimResult {
    const timestamp = this.clock();
    const now = timestamp.toISOString();
    const expiresAt = new Date(
      timestamp.getTime() + this.leaseMs,
    ).toISOString();
    const claim = this.database.transaction((): ClaimResult => {
      const run = this.database
        .prepare("SELECT rowid AS queue_order,* FROM runs WHERE id=?")
        .get(runId) as Row | undefined;
      if (!run || TERMINAL.has(String(run.status))) {
        return {
          claimed: false,
          terminal: true,
          blockedByRunId: null,
          reason: null,
        };
      }
      if (String(run.lease_owner ?? "") === this.ownerId) {
        return {
          claimed: true,
          terminal: false,
          blockedByRunId: null,
          reason: null,
        };
      }
      if (String(run.status) !== "queued") {
        return {
          claimed: false,
          terminal: false,
          blockedByRunId: String(run.id),
          reason: "active_run",
        };
      }
      if (run.runner_retry_at && String(run.runner_retry_at) > now) {
        return {
          claimed: false,
          terminal: false,
          blockedByRunId: String(run.id),
          reason: "active_run",
        };
      }
      if (this.maintenanceEnabled()) {
        return {
          claimed: false,
          terminal: false,
          blockedByRunId: null,
          reason: "maintenance",
        };
      }

      const active = this.database
        .prepare(
          `SELECT id FROM runs
           WHERE agent_id=? AND id<>?
             AND lease_owner IS NOT NULL AND lease_expires_at > ?
           ORDER BY rowid LIMIT 1`,
        )
        .get(String(run.agent_id), runId, now) as Row | undefined;
      if (active) {
        return {
          claimed: false,
          terminal: false,
          blockedByRunId: String(active.id),
          reason: "active_run",
        };
      }
      const earlier = this.database
        .prepare(
          `SELECT id FROM runs
           WHERE agent_id=? AND status='queued' AND rowid < ?
           ORDER BY rowid LIMIT 1`,
        )
        .get(String(run.agent_id), Number(run.queue_order)) as Row | undefined;
      if (earlier) {
        return {
          claimed: false,
          terminal: false,
          blockedByRunId: String(earlier.id),
          reason: "fifo",
        };
      }

      const changed = this.database
        .prepare(
          `UPDATE runs
           SET lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1
           WHERE id=? AND status='queued'
             AND (lease_owner IS NULL OR lease_expires_at <= ?)`,
        )
        .run(this.ownerId, expiresAt, runId, now);
      return {
        claimed: changed.changes === 1,
        terminal: false,
        blockedByRunId: changed.changes === 1 ? null : runId,
        reason: changed.changes === 1 ? null : "active_run",
      };
    });
    return claim.immediate();
  }

  private startLease(runId: string): RunLease {
    if (!this.heartbeats.has(runId)) {
      const heartbeat = setInterval(() => {
        const expiresAt = new Date(
          this.clock().getTime() + this.leaseMs,
        ).toISOString();
        this.database
          .prepare(
            `UPDATE runs SET lease_expires_at=?
             WHERE id=? AND lease_owner=?
               AND status IN ('queued','running','waiting_approval')`,
          )
          .run(expiresAt, runId, this.ownerId);
      }, this.heartbeatMs);
      heartbeat.unref();
      this.heartbeats.set(runId, heartbeat);
    }
    return {
      runId,
      ownerId: this.ownerId,
      isCurrent: () => this.ownsCurrentLease(runId),
      begin: () => this.beginRun(runId),
      release: () => this.release(runId),
    };
  }

  private beginRun(runId: string): "started" | "maintenance" | "lost" {
    const timestamp = this.clock().toISOString();
    const begin = this.database.transaction(() => {
      const changed = this.database
        .prepare(
          `UPDATE runs SET status='running',error=NULL,runner_retry_at=NULL
           WHERE id=? AND status='queued' AND lease_owner=?
             AND lease_expires_at > ?
             AND NOT EXISTS (
               SELECT 1 FROM settings
               WHERE key='system_maintenance_mode' AND value='on'
             )`,
        )
        .run(runId, this.ownerId, timestamp);
      if (changed.changes === 1) return "started" as const;
      if (this.maintenanceEnabled()) return "maintenance" as const;
      return "lost" as const;
    });
    return begin.immediate();
  }

  private ownsCurrentLease(runId: string) {
    const row = this.database
      .prepare(
        `SELECT 1 AS owned FROM runs
         WHERE id=? AND lease_owner=? AND lease_expires_at > ?
           AND status IN ('queued','running','waiting_approval')`,
      )
      .get(runId, this.ownerId, this.clock().toISOString()) as
      { owned: number } | undefined;
    return row?.owned === 1;
  }

  private release(runId: string) {
    const heartbeat = this.heartbeats.get(runId);
    if (heartbeat) clearInterval(heartbeat);
    this.heartbeats.delete(runId);
    this.database
      .prepare(
        "UPDATE runs SET lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=?",
      )
      .run(runId, this.ownerId);
  }
}
