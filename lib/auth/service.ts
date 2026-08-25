import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { authRepository } from "@/lib/repositories/auth-repository";
import { readSecret } from "@/lib/server-config";
import { hashPassword, verifyPassword } from "@/lib/auth/password.mjs";

export const AUTH_COOKIE_NAME = "slab_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const loginWindowMs = 15 * 60 * 1000;
const loginBlockMs = 60 * 1000;
const maximumAttempts = 5;

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
  return authRepository.adminIsConfigured();
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
  const row = authRepository.getLoginAttempt(clientKey);
  if (!row) return { blocked: false, retryAfterSeconds: 0 };

  const blockedUntil = row.blockedUntil ? new Date(row.blockedUntil) : null;
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
  authRepository.recordFailedLoginAttempt({
    clientKey,
    currentTime,
    windowMs: loginWindowMs,
    maximumAttempts,
    blockMs: loginBlockMs,
  });
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

  const credential = authRepository.getAdminCredential();
  if (!credential) {
    return { ok: false as const, code: "SETUP_REQUIRED" as const };
  }

  const valid = await verifyPassword(password, credential.passwordHash);
  if (!valid) {
    recordFailedAttempt(clientKey, currentTime);
    return { ok: false as const, code: "INVALID_CREDENTIALS" as const };
  }

  const token = randomBytes(32).toString("base64url");
  const timestamp = currentTime.toISOString();
  const expiresAt = new Date(
    currentTime.getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();
  authRepository.createSession({
    clientKey,
    tokenHash: keyedHash("session", token),
    generation: credential.sessionGeneration,
    createdAt: timestamp,
    expiresAt,
  });
  return { ok: true as const, token, expiresAt };
}

export function validateSession(token: string | undefined) {
  if (!authenticationRequired()) return true;
  if (!token) return false;

  const tokenHash = keyedHash("session", token);
  const row = authRepository.getSession(tokenHash);
  if (!row) return false;

  const currentTime = new Date();
  const expired = new Date(row.expiresAt) <= currentTime;
  const staleGeneration = row.generation !== row.sessionGeneration;
  if (expired || staleGeneration) {
    authRepository.deleteSession(tokenHash);
    return false;
  }

  const lastSeen = new Date(row.lastSeenAt);
  if (currentTime.getTime() - lastSeen.getTime() > 5 * 60 * 1000) {
    authRepository.touchSession(tokenHash, currentTime.toISOString());
  }
  return true;
}

export function revokeSession(token: string | undefined) {
  if (!token) return;
  authRepository.deleteSession(keyedHash("session", token));
}

export async function rotateAdminPassword(
  currentPassword: string,
  nextPassword: string,
) {
  const credential = authRepository.getAdminCredential();
  if (
    !credential ||
    !(await verifyPassword(currentPassword, credential.passwordHash))
  ) {
    return false;
  }

  const passwordHash = await hashPassword(nextPassword);
  return authRepository.rotateAdminCredential(
    passwordHash,
    new Date().toISOString(),
  );
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
