import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { filterToolsByRunPolicy } from "@/lib/agent-tool-policy";
import type { IntegrationRecord } from "@/lib/repositories/integration-repository";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  CALENDAR_READ_TOOLS,
  CALENDAR_TOOLS,
  CALENDAR_WRITE_TOOLS,
  calendarOAuthIdentityChanged,
  clearCalendarOAuthGrant,
  isCalendarProvider,
  normalizeWritePolicy,
  type CalendarAdapter,
  type CalendarConnectionInput,
  type CalendarCredentials,
} from "@/lib/integrations/calendar-contract";
import {
  createCalComAdapter,
  createCalDavAdapter,
  createGoogleCalendarAdapter,
  createIcsAdapter,
  createMicrosoftCalendarAdapter,
} from "@/lib/integrations/calendar-providers";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import { internalRoute } from "@/lib/server-config";
import type { CalendarProvider, Integration } from "@/lib/types";
import {
  IntegrationConfigurationError,
  IntegrationVersionConflictError,
} from "@/lib/integrations/errors";
import { OperationalError } from "@/lib/operational-error";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Calendars.ReadWrite"];

function normalizeName(value: string) {
  const name = value.trim().slice(0, 120);
  if (!name)
    throw new OperationalError("Calendar integration name is required.");
  return name;
}

function normalizeBaseUrl(
  value: string | undefined,
  fallback?: string,
  preserveTrailingSlash = false,
) {
  const url = new URL((value || fallback || "").trim());
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new OperationalError("Calendar service URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new OperationalError(
      "Calendar service URL must not contain credentials, query parameters, or a fragment.",
    );
  }
  const normalized = url.toString();
  return preserveTrailingSlash ? normalized : normalized.replace(/\/$/, "");
}

function parseCredentials(record: IntegrationRecord): CalendarCredentials {
  try {
    return JSON.parse(
      decryptLocalSecret(record.credentialsCiphertext),
    ) as CalendarCredentials;
  } catch {
    throw new OperationalError(
      "Stored calendar credentials could not be read.",
    );
  }
}

function emptyRecord(input: {
  id: string;
  provider: CalendarProvider;
  name: string;
  config: IntegrationRecord["config"];
  credentials: CalendarCredentials;
}): IntegrationRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    provider: input.provider,
    name: input.name,
    slug: input.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48),
    config: input.config,
    authType: "none",
    authHeaderName: null,
    enabled: true,
    version: 1,
    credentialsCiphertext: encryptLocalSecret(
      JSON.stringify(input.credentials),
    ),
    status: "not_tested",
    lastTestedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createAdapter(
  record: IntegrationRecord,
  credentials = parseCredentials(record),
): CalendarAdapter {
  const update = (next: CalendarCredentials) => {
    const updated = integrationRepository.updateIntegrationCredentialsIfCurrent(
      {
        id: record.id,
        expectedVersion: record.version,
        expectedCredentialsCiphertext: record.credentialsCiphertext,
        credentialsCiphertext: encryptLocalSecret(JSON.stringify(next)),
      },
    );
    if (!updated) {
      throw new OperationalError(
        "Calendar configuration changed while credentials were refreshing. Retry with the current integration.",
      );
    }
  };
  switch (record.provider) {
    case "calendar_google":
      return createGoogleCalendarAdapter(credentials, update);
    case "calendar_microsoft":
      return createMicrosoftCalendarAdapter(
        credentials,
        String(record.config.providerMetadata?.tenant ?? "common"),
        update,
      );
    case "calendar_caldav":
      return createCalDavAdapter(record, credentials);
    case "calendar_calcom":
      return createCalComAdapter(record, credentials);
    case "calendar_ics":
      return createIcsAdapter(record, credentials);
    default:
      throw new OperationalError("Unsupported calendar provider.");
  }
}

function mergeCredentials(
  current: CalendarCredentials | null,
  input: CalendarConnectionInput,
) {
  return {
    ...current,
    ...(input.clientId ? { clientId: input.clientId.trim() } : {}),
    ...(input.clientSecret ? { clientSecret: input.clientSecret.trim() } : {}),
    ...(input.username ? { username: input.username.trim() } : {}),
    ...(input.password ? { password: input.password } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey.trim() } : {}),
    ...(input.feedUrl ? { feedUrl: input.feedUrl.trim() } : {}),
  } satisfies CalendarCredentials;
}

function assertCredentialReuseSafe(
  current: IntegrationRecord | null,
  input: CalendarConnectionInput,
  nextBaseUrl: string | undefined,
) {
  if (!current) return;
  if (current.provider !== input.provider) {
    throw new OperationalError(
      "Calendar provider cannot be changed after creation.",
    );
  }
  if (
    (input.provider === "calendar_caldav" ||
      input.provider === "calendar_calcom") &&
    current.config.baseUrl &&
    nextBaseUrl &&
    new URL(current.config.baseUrl).origin !== new URL(nextBaseUrl).origin
  ) {
    const replacement =
      input.provider === "calendar_caldav" ? input.password : input.apiKey;
    if (!replacement) {
      throw new OperationalError(
        "A fresh credential is required when the calendar service origin changes.",
      );
    }
  }
  if (
    input.provider === "calendar_caldav" &&
    input.username &&
    parseCredentials(current).username !== input.username.trim() &&
    !input.password
  ) {
    throw new OperationalError(
      "A fresh password is required when the CalDAV username changes.",
    );
  }
  if (
    (input.provider === "calendar_google" ||
      input.provider === "calendar_microsoft") &&
    input.clientId &&
    parseCredentials(current).clientId !== input.clientId.trim() &&
    !input.clientSecret
  ) {
    throw new OperationalError(
      "A fresh OAuth client secret is required when the client ID changes.",
    );
  }
  if (
    input.provider === "calendar_microsoft" &&
    input.tenant &&
    String(current.config.providerMetadata?.tenant ?? "common") !==
      input.tenant.trim() &&
    !input.clientSecret
  ) {
    throw new OperationalError(
      "A fresh OAuth client secret is required when the Microsoft tenant changes.",
    );
  }
}

export function listCalendarIntegrations() {
  return integrationRepository
    .listIntegrations()
    .filter((integration) => isCalendarProvider(integration.provider));
}

export async function saveCalendarIntegration(
  input: CalendarConnectionInput,
): Promise<Integration> {
  if (!isCalendarProvider(input.provider)) {
    throw new OperationalError("Unsupported calendar provider.");
  }
  const current = input.id
    ? integrationRepository.getIntegrationRecord(input.id)
    : null;
  if (input.id && input.expectedVersion === undefined) {
    throw new IntegrationConfigurationError(
      "expectedVersion is required when updating a calendar integration.",
    );
  }
  if (
    input.expectedVersion !== undefined &&
    (!current || current.version !== input.expectedVersion)
  ) {
    throw new IntegrationVersionConflictError();
  }
  const currentCredentials = current ? parseCredentials(current) : null;
  const name = normalizeName(input.name);
  const baseUrl =
    input.provider === "calendar_caldav"
      ? normalizeBaseUrl(input.baseUrl, undefined, true)
      : input.provider === "calendar_calcom"
        ? normalizeBaseUrl(input.baseUrl, "https://api.cal.com")
        : undefined;
  assertCredentialReuseSafe(current, input, baseUrl);
  const identityChanged = current
    ? calendarOAuthIdentityChanged({
        provider: input.provider,
        currentClientId: currentCredentials?.clientId,
        nextClientId: input.clientId?.trim(),
        currentTenant: String(
          current.config.providerMetadata?.tenant ?? "common",
        ),
        nextTenant: input.tenant?.trim(),
        replacesClientSecret: Boolean(input.clientSecret),
      })
    : false;
  const mergedCredentials = mergeCredentials(currentCredentials, input);
  const credentials = identityChanged
    ? clearCalendarOAuthGrant(mergedCredentials)
    : mergedCredentials;
  if (
    (input.provider === "calendar_google" ||
      input.provider === "calendar_microsoft") &&
    (!credentials.clientId || !credentials.clientSecret)
  ) {
    throw new OperationalError(
      "OAuth client ID and client secret are required.",
    );
  }
  if (
    input.provider === "calendar_caldav" &&
    (!credentials.username || !credentials.password)
  ) {
    throw new OperationalError("CalDAV username and password are required.");
  }
  if (input.provider === "calendar_calcom" && !credentials.apiKey) {
    throw new OperationalError("Cal.com API key is required.");
  }
  if (input.provider === "calendar_ics") {
    if (!credentials.feedUrl)
      throw new OperationalError("Shared ICS URL is required.");
    const feed = new URL(credentials.feedUrl);
    if (!new Set(["http:", "https:"]).has(feed.protocol)) {
      throw new OperationalError("Shared ICS URL must use HTTP or HTTPS.");
    }
  }

  const config: IntegrationRecord["config"] = {
    baseUrl,
    authType: "none",
    accountEmail: identityChanged
      ? null
      : input.accountEmail?.trim() || current?.config.accountEmail || null,
    accountName: identityChanged
      ? null
      : input.accountName?.trim() || current?.config.accountName || null,
    writePolicy:
      input.provider === "calendar_ics"
        ? "disabled"
        : normalizeWritePolicy(
            input.writePolicy ?? current?.config.writePolicy,
          ),
    oauthConfigured:
      input.provider === "calendar_google" ||
      input.provider === "calendar_microsoft"
        ? Boolean(credentials.clientId && credentials.clientSecret)
        : false,
    username:
      input.provider === "calendar_caldav"
        ? (credentials.username ?? null)
        : null,
    eventTypeId:
      input.provider === "calendar_calcom"
        ? (input.eventTypeId ?? current?.config.eventTypeId ?? null)
        : null,
    providerMetadata:
      input.provider === "calendar_microsoft"
        ? {
            tenant:
              input.tenant?.trim() ||
              current?.config.providerMetadata?.tenant ||
              "common",
          }
        : {},
  };
  const id = current?.id ?? input.id ?? randomUUID();
  const staged = emptyRecord({
    id,
    provider: input.provider,
    name,
    config,
    credentials,
  });
  const providerTools =
    input.provider === "calendar_ics"
      ? [...CALENDAR_READ_TOOLS]
      : [...CALENDAR_TOOLS];
  const permissions =
    input.agentIds !== undefined
      ? Object.fromEntries(
          [...new Set(input.agentIds)].map((agentId) => {
            if (!agentRepository.getAgent(agentId)) {
              throw new OperationalError(`Agent ${agentId} was not found.`);
            }
            return [agentId, providerTools];
          }),
        )
      : current
        ? integrationRepository.listIntegrationPermissions(current.id)
        : {};
  const requiresOAuth =
    input.provider === "calendar_google" ||
    input.provider === "calendar_microsoft";
  let status: Integration["status"] = requiresOAuth
    ? identityChanged || !current
      ? "not_tested"
      : current.status === "disabled" && input.enabled !== false
        ? current.lastTestedAt && !current.lastError
          ? "connected"
          : "not_tested"
        : current.status
    : "connected";
  let lastError: string | null =
    requiresOAuth && !identityChanged ? (current?.lastError ?? null) : null;
  let account: { accountEmail?: string; accountName?: string } = {};
  if (!requiresOAuth) {
    try {
      account = await createAdapter(staged, credentials).test();
    } catch (error) {
      status = "failed";
      lastError =
        error instanceof Error ? error.message : "Calendar connection failed.";
    }
  }
  return integrationRepository.saveIntegration({
    id,
    provider: input.provider,
    name,
    config: {
      ...config,
      accountEmail: account.accountEmail ?? config.accountEmail,
      accountName: account.accountName ?? config.accountName,
    },
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status: input.enabled === false ? "disabled" : status,
    lastTestedAt: requiresOAuth
      ? identityChanged
        ? null
        : (current?.lastTestedAt ?? null)
      : new Date().toISOString(),
    lastError,
    enabled: input.enabled ?? current?.enabled ?? true,
    permissions,
    expectedVersion: input.expectedVersion,
  });
}

export async function testCalendarIntegration(id: string) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || !isCalendarProvider(record.provider)) {
    throw new OperationalError("Calendar integration not found.");
  }
  const testedAt = new Date().toISOString();
  try {
    const account = await createAdapter(record).test();
    const completed = integrationRepository.completeIntegrationTest({
      id,
      expectedVersion: record.version,
      status: record.enabled ? "connected" : "disabled",
      testedAt,
      lastError: null,
      accountEmail: account.accountEmail,
      accountName: account.accountName,
    });
    if (!completed) {
      throw new OperationalError(
        "Calendar configuration changed while the connection test was running. Test the current configuration again.",
      );
    }
    return integrationRepository.getIntegration(id)!;
  } catch (error) {
    const failed = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: "failed",
        lastTestedAt: testedAt,
        lastError:
          error instanceof Error
            ? error.message
            : "Calendar connection failed.",
      },
    );
    if (!failed) throw error;
    return failed;
  }
}

function base64UrlSha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function startCalendarOAuth(integrationId: string, redirectUri: string) {
  const record = integrationRepository.getIntegrationRecord(integrationId);
  if (
    !record ||
    (record.provider !== "calendar_google" &&
      record.provider !== "calendar_microsoft")
  ) {
    throw new OperationalError("OAuth calendar integration not found.");
  }
  const credentials = parseCredentials(record);
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new OperationalError("OAuth credentials are not configured.");
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  integrationRepository.createIntegrationOAuthState({
    id: state,
    integrationId,
    provider: record.provider,
    verifierCiphertext: encryptLocalSecret(verifier),
    redirectUri,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    integrationVersion: record.version,
  });
  const challenge = base64UrlSha256(verifier);
  if (record.provider === "calendar_google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }
  const tenant = String(record.config.providerMetadata?.tenant ?? "common");
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

async function exchangeOAuthCode(input: {
  state: string;
  code: string;
  provider: "calendar_google" | "calendar_microsoft";
}) {
  const pending = integrationRepository.consumeIntegrationOAuthState(
    input.state,
  );
  if (!pending || pending.provider !== input.provider) {
    throw new OperationalError("OAuth state is invalid or expired.");
  }
  const record = integrationRepository.getIntegrationRecord(
    pending.integrationId,
  );
  if (!record || record.provider !== input.provider) {
    throw new OperationalError("Calendar integration no longer exists.");
  }
  if (record.version !== pending.integrationVersion) {
    throw new OperationalError(
      "Calendar configuration changed while authorization was in progress. Start authorization again.",
    );
  }
  try {
    const credentials = parseCredentials(record);
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new OperationalError("OAuth credentials are incomplete.");
    }
    const verifier = decryptLocalSecret(pending.verifierCiphertext);
    const endpoint =
      input.provider === "calendar_google"
        ? "https://oauth2.googleapis.com/token"
        : `https://login.microsoftonline.com/${encodeURIComponent(String(record.config.providerMetadata?.tenant ?? "common"))}/oauth2/v2.0/token`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code: input.code,
        redirect_uri: pending.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
        ...(input.provider === "calendar_microsoft"
          ? { scope: MICROSOFT_SCOPES.join(" ") }
          : {}),
      }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    } | null;
    if (!response.ok || !body?.access_token || !body.refresh_token) {
      throw new OperationalError(
        `OAuth provider returned HTTP ${response.status}. Verify the client configuration and try again.`,
      );
    }
    const nextCredentials: CalendarCredentials = {
      ...credentials,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
      ).toISOString(),
    };
    const staged = {
      ...record,
      credentialsCiphertext: encryptLocalSecret(
        JSON.stringify(nextCredentials),
      ),
    };
    const account = await createAdapter(staged, nextCredentials).test();
    const testedAt = new Date().toISOString();
    const completed = integrationRepository.completeCalendarOAuth({
      id: record.id,
      provider: input.provider,
      expectedVersion: pending.integrationVersion,
      credentialsCiphertext: staged.credentialsCiphertext,
      accountEmail: account.accountEmail,
      accountName: account.accountName,
      testedAt,
    });
    if (!completed) {
      throw new OperationalError(
        "Calendar configuration changed while authorization was in progress. Start authorization again from the current configuration.",
      );
    }
    return integrationRepository.getIntegration(record.id)!;
  } catch (error) {
    integrationRepository.updateIntegrationCheckIfVersion(
      record.id,
      pending.integrationVersion,
      {
        status: "failed",
        lastTestedAt: new Date().toISOString(),
        lastError:
          "OAuth authorization failed. Verify the client, callback, tenant, and consent settings, then try again.",
      },
    );
    throw error;
  }
}

export function finishGoogleCalendarOAuth(state: string, code: string) {
  return exchangeOAuthCode({ state, code, provider: "calendar_google" });
}

export function finishMicrosoftCalendarOAuth(state: string, code: string) {
  return exchangeOAuthCode({ state, code, provider: "calendar_microsoft" });
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function tokenMatches(value: string, expectedHash: string) {
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getRunCalendarRuntimeAccess(
  integrationId: string,
  runId: string,
  token: string,
) {
  const capability = integrationRepository.getRunIntegrationCapability(
    runId,
    integrationId,
  );
  const run = runRepository.getRun(runId);
  if (
    !capability ||
    !run ||
    run.agentId !== capability.agentId ||
    !["running", "waiting_approval"].includes(run.status) ||
    !token ||
    !tokenMatches(token, capability.tokenHash)
  )
    return { status: "unauthorized" as const };
  const record = integrationRepository.getIntegrationRecord(integrationId);
  if (!record || !isCalendarProvider(record.provider)) {
    return { status: "unauthorized" as const };
  }
  if (record.version !== capability.integrationVersion) {
    return {
      status: "stale" as const,
      integrationVersion: capability.integrationVersion,
      currentVersion: record.version,
    };
  }
  return {
    status: "ok" as const,
    record,
    adapter: createAdapter(record),
    allowedTools: filterToolsByRunPolicy(
      runId,
      `calendar_${record.slug}`,
      capability.allowedTools,
    ),
  };
}

export function getAgentCalendarIntegrationsMcp(
  agentId: string,
  runId: string,
) {
  const existing = integrationRepository
    .listRunIntegrationCapabilities(runId)
    .filter((capability) => {
      const integration = integrationRepository.getIntegrationRecord(
        capability.integrationId,
      );
      return integration ? isCalendarProvider(integration.provider) : false;
    });
  const alreadyCaptured = integrationRepository.hasRunIntegrationSnapshot(
    runId,
    "calendar",
  );
  const captureFromLive = !alreadyCaptured && existing.length === 0;
  if (!alreadyCaptured) {
    integrationRepository.markRunIntegrationSnapshot(runId, "calendar");
  }
  const candidates = !captureFromLive
    ? existing
        .filter((capability) => capability.agentId === agentId)
        .map((capability) => ({
          integration: integrationRepository.getIntegration(
            capability.integrationId,
          ),
          allowedTools: capability.allowedTools,
          version: capability.integrationVersion,
        }))
    : listCalendarIntegrations().map((integration) => ({
        integration,
        allowedTools:
          integrationRepository.listIntegrationPermissions(integration.id)[
            agentId
          ] ?? [],
        version: integration.version ?? 1,
      }));
  return candidates.flatMap(({ integration, allowedTools, version }) => {
    if (
      !integration ||
      !isCalendarProvider(integration.provider) ||
      !integration.enabled ||
      integration.status !== "connected"
    )
      return [];
    const policy = normalizeWritePolicy(integration.writePolicy);
    const providerTools =
      integration.provider === "calendar_ics"
        ? [...CALENDAR_READ_TOOLS]
        : [...CALENDAR_TOOLS];
    const allowed = allowedTools.filter(
      (tool) =>
        providerTools.includes(tool as (typeof CALENDAR_TOOLS)[number]) &&
        (policy !== "disabled" ||
          !CALENDAR_WRITE_TOOLS.includes(
            tool as (typeof CALENDAR_WRITE_TOOLS)[number],
          )),
    );
    if (!allowed.length) return [];
    const token = randomBytes(32).toString("base64url");
    const capability = integrationRepository.saveRunIntegrationCapability({
      runId,
      integrationId: integration.id,
      agentId,
      integrationVersion: version,
      tokenHash: hashToken(token),
      allowedTools: allowed,
    });
    return [
      {
        server: {
          name: `calendar_${integration.slug}`,
          url: internalRoute(
            `/api/integrations/${encodeURIComponent(integration.id)}/mcp?run=${encodeURIComponent(runId)}`,
          ),
          credentials: { bearerToken: token },
          approval: {
            defaultMode: "approve" as const,
            tools:
              policy === "approval_required"
                ? Object.fromEntries(
                    CALENDAR_WRITE_TOOLS.filter((tool) =>
                      allowed.includes(tool),
                    ).map((tool) => [tool, "prompt" as const]),
                  )
                : {},
          },
        },
        snapshot: {
          integrationId: integration.id,
          provider: integration.provider,
          name: integration.name,
          version: capability.integrationVersion,
          tools: capability.allowedTools,
          writePolicy: policy,
        },
      },
    ];
  });
}

export function deleteCalendarIntegration(id: string, expectedVersion: number) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || !isCalendarProvider(record.provider)) {
    throw new OperationalError("Calendar integration not found.");
  }
  return integrationRepository.deleteIntegration(id, expectedVersion);
}

export function setCalendarIntegrationEnabled(
  id: string,
  enabled: boolean,
  expectedVersion: number,
) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || !isCalendarProvider(record.provider)) {
    throw new OperationalError("Calendar integration not found.");
  }
  return integrationRepository.saveIntegration({
    id: record.id,
    provider: record.provider,
    name: record.name,
    config: record.config,
    credentialsCiphertext: record.credentialsCiphertext,
    status: enabled
      ? record.lastTestedAt && !record.lastError
        ? "connected"
        : "not_tested"
      : "disabled",
    lastTestedAt: record.lastTestedAt,
    lastError: record.lastError,
    enabled,
    permissions: integrationRepository.listIntegrationPermissions(record.id),
    expectedVersion,
  });
}
