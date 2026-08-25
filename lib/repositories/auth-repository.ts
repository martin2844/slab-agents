import "server-only";

import { db } from "@/lib/db/database";

type AuthCredentialRecord = {
  passwordHash: string;
  sessionGeneration: number;
};

export type LoginAttemptRecord = {
  attempts: number;
  windowStartedAt: string;
  blockedUntil: string | null;
};

export type SessionRecord = {
  generation: number;
  sessionGeneration: number;
  expiresAt: string;
  lastSeenAt: string;
};

export const authRepository = {
  adminIsConfigured() {
    return Boolean(
      db
        .prepare(
          "SELECT 1 AS configured FROM auth_credentials WHERE id = 'admin'",
        )
        .get(),
    );
  },

  getAdminCredential(): AuthCredentialRecord | null {
    const row = db
      .prepare(
        "SELECT password_hash,session_generation FROM auth_credentials WHERE id = 'admin'",
      )
      .get() as
      { password_hash: string; session_generation: number } | undefined;
    return row
      ? {
          passwordHash: String(row.password_hash),
          sessionGeneration: Number(row.session_generation),
        }
      : null;
  },

  getLoginAttempt(clientKey: string): LoginAttemptRecord | null {
    const row = db
      .prepare(
        "SELECT attempts,window_started_at,blocked_until FROM auth_login_attempts WHERE client_key=?",
      )
      .get(clientKey) as
      | {
          attempts: number;
          window_started_at: string;
          blocked_until: string | null;
        }
      | undefined;
    return row
      ? {
          attempts: Number(row.attempts),
          windowStartedAt: String(row.window_started_at),
          blockedUntil: row.blocked_until ? String(row.blocked_until) : null,
        }
      : null;
  },

  recordFailedLoginAttempt(input: {
    clientKey: string;
    currentTime: Date;
    windowMs: number;
    maximumAttempts: number;
    blockMs: number;
  }) {
    return db
      .transaction(() => {
        const current = authRepository.getLoginAttempt(input.clientKey);
        const currentIso = input.currentTime.toISOString();
        const windowStartedAt = current?.windowStartedAt
          ? new Date(current.windowStartedAt)
          : input.currentTime;
        const withinWindow =
          input.currentTime.getTime() - windowStartedAt.getTime() <=
          input.windowMs;
        const attempts = withinWindow ? (current?.attempts ?? 0) + 1 : 1;
        const blockedUntil =
          attempts >= input.maximumAttempts
            ? new Date(
                input.currentTime.getTime() + input.blockMs,
              ).toISOString()
            : null;

        db.prepare(
          `INSERT INTO auth_login_attempts
          (client_key,attempts,window_started_at,blocked_until,updated_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(client_key) DO UPDATE SET
          attempts=excluded.attempts,
          window_started_at=excluded.window_started_at,
          blocked_until=excluded.blocked_until,
          updated_at=excluded.updated_at`,
        ).run(
          input.clientKey,
          attempts,
          withinWindow ? windowStartedAt.toISOString() : currentIso,
          blockedUntil,
          currentIso,
        );
        return { attempts, blockedUntil };
      })
      .immediate();
  },

  createSession(input: {
    clientKey: string;
    tokenHash: string;
    generation: number;
    createdAt: string;
    expiresAt: string;
  }) {
    db.transaction(() => {
      db.prepare("DELETE FROM auth_login_attempts WHERE client_key=?").run(
        input.clientKey,
      );
      db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").run(
        input.createdAt,
      );
      db.prepare(
        `INSERT INTO auth_sessions
          (token_hash,generation,created_at,last_seen_at,expires_at)
         VALUES (?,?,?,?,?)`,
      ).run(
        input.tokenHash,
        input.generation,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
      );
    })();
  },

  getSession(tokenHash: string): SessionRecord | null {
    const row = db
      .prepare(
        `SELECT sessions.generation,sessions.expires_at,sessions.last_seen_at,
                credentials.session_generation
         FROM auth_sessions AS sessions
         JOIN auth_credentials AS credentials ON credentials.id='admin'
         WHERE sessions.token_hash=?`,
      )
      .get(tokenHash) as
      | {
          generation: number;
          session_generation: number;
          expires_at: string;
          last_seen_at: string;
        }
      | undefined;
    return row
      ? {
          generation: Number(row.generation),
          sessionGeneration: Number(row.session_generation),
          expiresAt: String(row.expires_at),
          lastSeenAt: String(row.last_seen_at),
        }
      : null;
  },

  deleteSession(tokenHash: string) {
    db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(tokenHash);
  },

  touchSession(tokenHash: string, lastSeenAt: string) {
    db.prepare(
      "UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?",
    ).run(lastSeenAt, tokenHash);
  },

  rotateAdminCredential(passwordHash: string, updatedAt: string) {
    return db.transaction(() => {
      const changed = db
        .prepare(
          `UPDATE auth_credentials
           SET password_hash=?,session_generation=session_generation+1,updated_at=?
           WHERE id='admin'`,
        )
        .run(passwordHash, updatedAt).changes;
      if (changed === 1) db.prepare("DELETE FROM auth_sessions").run();
      return changed === 1;
    })();
  },
};
