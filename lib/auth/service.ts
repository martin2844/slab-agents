import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { readSecret } from "@/lib/server-config";
import { hashPassword, verifyPassword } from "@/lib/auth/password.mjs";

export const AUTH_COOKIE_NAME = "slab_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const loginWindowMs = 15 * 60 * 1000;
const loginBlockMs = 60 * 1000;
const maximumAttempts = 5;

type Row = Record<string, unknown>;

function sessionSecret() {
  const secret = readSecret("SLAB_SESSION_SECRET", "SLAB_SESSION_SECRET_FILE");
  if (secret.length < 32) {
    throw new Error(
      "Slab Agents authentication requires a session secret of at least 32 characters.",
    );
  }
  return secret;
}

function keyedHash(purpose: string, value: string) {
  return createHmac("sha256", sessionSecret())
    .update(`${purpose}\0${value}`)
    .digest("hex");
}

export function authenticationRequired() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.SLAB_AUTH_ENABLED === "true"
  );
}

export function adminIsConfigured() {
  const row = db
    .prepare("SELECT 1 AS configured FROM auth_credentials WHERE id = 'admin'")
    .get() as Row | undefined;
  return Boolean(row?.configured);
}

export function loginClientIdentifier(request: Request) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const remote = forwarded || request.headers.get("x-real-ip") || "unknown";
  const userAgent =
    request.headers.get("user-agent")?.slice(0, 160) || "unknown";
  return `${remote}\0${userAgent}`;
}

function throttleState(clientKey: string, currentTime: Date) {
  const row = db
    .prepare("SELECT * FROM auth_login_attempts WHERE client_key = ?")
    .get(clientKey) as Row | undefined;
  if (!row) return { blocked: false, retryAfterSeconds: 0 };

  const blockedUntil = row.blocked_until
    ? new Date(String(row.blocked_until))
    : null;
  if (blockedUntil && blockedUntil > currentTime) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((blockedUntil.getTime() - currentTime.getTime()) / 1000),
      ),
    };
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

function recordFailedAttempt(clientKey: string, currentTime: Date) {
  const currentIso = currentTime.toISOString();
  const row = db
    .prepare("SELECT * FROM auth_login_attempts WHERE client_key = ?")
    .get(clientKey) as Row | undefined;
  const windowStartedAt = row?.window_started_at
    ? new Date(String(row.window_started_at))
    : currentTime;
  const withinWindow =
    currentTime.getTime() - windowStartedAt.getTime() <= loginWindowMs;
  const attempts = withinWindow ? Number(row?.attempts ?? 0) + 1 : 1;
  const blockedUntil =
    attempts >= maximumAttempts
      ? new Date(currentTime.getTime() + loginBlockMs).toISOString()
      : null;

  db.prepare(
    `INSERT INTO auth_login_attempts
      (client_key, attempts, window_started_at, blocked_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_key) DO UPDATE SET
       attempts = excluded.attempts,
       window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until,
       updated_at = excluded.updated_at`,
  ).run(
    clientKey,
    attempts,
    withinWindow ? windowStartedAt.toISOString() : currentIso,
    blockedUntil,
    currentIso,
  );
}

export async function authenticateAdmin(
  password: string,
  clientIdentifier: string,
) {
  const currentTime = new Date();
  const clientKey = keyedHash("login-client", clientIdentifier);
  const throttle = throttleState(clientKey, currentTime);
  if (throttle.blocked) {
    return {
      ok: false as const,
      code: "RATE_LIMITED" as const,
      retryAfterSeconds: throttle.retryAfterSeconds,
    };
  }

  const credential = db
    .prepare(
      "SELECT password_hash, session_generation FROM auth_credentials WHERE id = 'admin'",
    )
    .get() as Row | undefined;
  if (!credential) {
    return { ok: false as const, code: "SETUP_REQUIRED" as const };
  }

  const valid = await verifyPassword(
    password,
    String(credential.password_hash),
  );
  if (!valid) {
    recordFailedAttempt(clientKey, currentTime);
    return { ok: false as const, code: "INVALID_CREDENTIALS" as const };
  }

  const token = randomBytes(32).toString("base64url");
  const timestamp = currentTime.toISOString();
  const expiresAt = new Date(
    currentTime.getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM auth_login_attempts WHERE client_key = ?").run(
      clientKey,
    );
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(
      timestamp,
    );
    db.prepare(
      `INSERT INTO auth_sessions
        (token_hash, generation, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      keyedHash("session", token),
      Number(credential.session_generation),
      timestamp,
      timestamp,
      expiresAt,
    );
  });
  transaction();
  return { ok: true as const, token, expiresAt };
}

export function validateSession(token: string | undefined) {
  if (!authenticationRequired()) return true;
  if (!token) return false;

  const tokenHash = keyedHash("session", token);
  const row = db
    .prepare(
      `SELECT sessions.generation, sessions.expires_at, sessions.last_seen_at,
              credentials.session_generation
       FROM auth_sessions AS sessions
       JOIN auth_credentials AS credentials ON credentials.id = 'admin'
       WHERE sessions.token_hash = ?`,
    )
    .get(tokenHash) as Row | undefined;
  if (!row) return false;

  const currentTime = new Date();
  const expired = new Date(String(row.expires_at)) <= currentTime;
  const staleGeneration =
    Number(row.generation) !== Number(row.session_generation);
  if (expired || staleGeneration) {
    db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
    return false;
  }

  const lastSeen = new Date(String(row.last_seen_at));
  if (currentTime.getTime() - lastSeen.getTime() > 5 * 60 * 1000) {
    db.prepare(
      "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?",
    ).run(currentTime.toISOString(), tokenHash);
  }
  return true;
}

export function revokeSession(token: string | undefined) {
  if (!token) return;
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(
    keyedHash("session", token),
  );
}

export async function rotateAdminPassword(
  currentPassword: string,
  nextPassword: string,
) {
  const credential = db
    .prepare("SELECT password_hash FROM auth_credentials WHERE id = 'admin'")
    .get() as Row | undefined;
  if (
    !credential ||
    !(await verifyPassword(currentPassword, String(credential.password_hash)))
  ) {
    return false;
  }

  const passwordHash = await hashPassword(nextPassword);
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE auth_credentials
       SET password_hash = ?, session_generation = session_generation + 1,
           updated_at = ?
       WHERE id = 'admin'`,
    ).run(passwordHash, new Date().toISOString());
    db.prepare("DELETE FROM auth_sessions").run();
  });
  transaction();
  return true;
}

export function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";

  try {
    const source = new URL(origin);
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0];
    const host = forwardedHost?.trim() || request.headers.get("host");
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const requestUrl = new URL(request.url);
    const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");
    return (
      Boolean(host) &&
      source.host === host &&
      source.protocol === `${protocol}:`
    );
  } catch {
    return false;
  }
}

export function secureRequest(request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return (
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:"
  );
}

export function authStatus() {
  return {
    required: authenticationRequired(),
    configured: adminIsConfigured(),
  };
}

export function authenticationReadiness() {
  const required = authenticationRequired();
  if (!required) {
    return {
      ready: true,
      required: false,
      configured: true,
      secretConfigured: true,
    };
  }

  let secretConfigured = false;
  try {
    sessionSecret();
    secretConfigured = true;
  } catch {
    // Readiness exposes state only, never secret content or secret filenames.
  }
  const configured = adminIsConfigured();
  return {
    ready: secretConfigured && configured,
    required: true,
    configured,
    secretConfigured,
  };
}
