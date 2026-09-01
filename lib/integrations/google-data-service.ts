import "server-only";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { filterToolsByRunPolicy } from "@/lib/agent-tool-policy";
import { withImmediateTransaction } from "@/lib/db/transaction";
import {
  clearGoogleDataGrant,
  GOOGLE_DATA_SCOPES,
  GOOGLE_DATA_TOOL_KEYS,
  isGoogleDataProvider,
  type GoogleDataConnectionInput,
  type GoogleDataCredentials,
  type GoogleDataProvider,
} from "@/lib/integrations/google-data-contract";
import { createGoogleDataAdapter } from "@/lib/integrations/google-data-client";
import { getGmailOAuthCredentialsForGoogleData } from "@/lib/integrations/email-service";
import {
  IntegrationConfigurationError,
  IntegrationNotFoundError,
  IntegrationVersionConflictError,
} from "@/lib/integrations/errors";
import { OperationalError } from "@/lib/operational-error";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import type { IntegrationRecord } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import { internalRoute } from "@/lib/server-config";
import type { Integration } from "@/lib/types";

function parseCredentials(record: IntegrationRecord): GoogleDataCredentials {
  try {
    const value = JSON.parse(
      decryptLocalSecret(record.credentialsCiphertext),
    ) as GoogleDataCredentials;
    if (!value.clientId || !value.clientSecret) throw new Error("incomplete");
    return value;
  } catch {
    throw new OperationalError(
      "Stored Google integration credentials could not be read.",
    );
  }
}

function updateCredentials(
  record: IntegrationRecord,
  credentials: GoogleDataCredentials,
) {
  const updated = integrationRepository.updateIntegrationCredentialsIfCurrent({
    id: record.id,
    expectedVersion: record.version,
    expectedCredentialsCiphertext: record.credentialsCiphertext,
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
  });
  if (!updated) {
    throw new OperationalError(
      "Google integration configuration changed while authorization was refreshing. Retry with the current integration.",
    );
  }
}

function createAdapter(
  record: IntegrationRecord,
  credentials = parseCredentials(record),
) {
  if (!isGoogleDataProvider(record.provider)) {
    throw new OperationalError("Unsupported Google data provider.");
  }
  return createGoogleDataAdapter(record.provider, credentials, (next) =>
    updateCredentials(record, next),
  );
}

function normalizePermissions(
  provider: GoogleDataProvider,
  permissions: Record<string, string[]> | undefined,
) {
  const valid = new Set<string>(GOOGLE_DATA_TOOL_KEYS[provider]);
  return Object.fromEntries(
    Object.entries(permissions ?? {}).flatMap(([agentId, tools]) => {
      if (!agentRepository.getAgent(agentId)) return [];
      const allowed = [...new Set(tools)].filter((tool) => valid.has(tool));
      return allowed.length ? [[agentId, allowed]] : [];
    }),
  );
}

export function listGoogleDataIntegrations() {
  return integrationRepository
    .listIntegrations()
    .filter((integration) => isGoogleDataProvider(integration.provider));
}

export async function saveGoogleDataIntegration(
  input: GoogleDataConnectionInput,
): Promise<Integration> {
  const current = input.id
    ? integrationRepository.getIntegrationRecord(input.id)
    : null;
  if (
    !input.id &&
    integrationRepository.getIntegrationRecordByProvider(input.provider)
  ) {
    throw new IntegrationVersionConflictError(
      "This Google integration is already configured. Reload and edit the existing connection.",
    );
  }
  if (input.id && input.expectedVersion === undefined) {
    throw new IntegrationConfigurationError(
      "expectedVersion is required when updating a Google integration.",
    );
  }
  if (
    input.expectedVersion !== undefined &&
    (!current || current.version !== input.expectedVersion)
  ) {
    throw new IntegrationVersionConflictError();
  }
  if (current && current.provider !== input.provider) {
    throw new IntegrationConfigurationError(
      "Google integration provider cannot be changed after creation.",
    );
  }
  const name = input.name.trim();
  if (!name) throw new OperationalError("Integration name is required.");
  const previous = current ? parseCredentials(current) : null;
  if (
    input.reuseGmailOAuthCredentials &&
    (input.clientId !== undefined || input.clientSecret !== undefined)
  ) {
    throw new IntegrationConfigurationError(
      "Choose either Gmail OAuth credentials or different Google OAuth credentials.",
    );
  }
  const reused = input.reuseGmailOAuthCredentials
    ? await getGmailOAuthCredentialsForGoogleData()
    : null;
  if (
    previous &&
    !reused &&
    input.clientId &&
    input.clientId.trim() !== previous.clientId &&
    !input.clientSecret
  ) {
    throw new OperationalError(
      "A fresh OAuth client secret is required when the client ID changes.",
    );
  }
  const clientId = reused?.clientId ?? input.clientId?.trim() ?? previous?.clientId;
  const clientSecret =
    reused?.clientSecret ?? input.clientSecret ?? previous?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new OperationalError(
      "Google OAuth client ID and client secret are required.",
    );
  }
  const identityChanged = Boolean(
    previous &&
      (clientId !== previous.clientId || clientSecret !== previous.clientSecret),
  );
  const merged: GoogleDataCredentials = {
    ...previous,
    clientId,
    clientSecret,
  };
  const credentials = identityChanged ? clearGoogleDataGrant(merged) : merged;
  const enabled = input.enabled ?? current?.enabled ?? true;
  const status = !enabled
    ? "disabled"
    : !current || identityChanged
      ? "not_tested"
      : current.status === "disabled"
        ? current.lastTestedAt && !current.lastError
          ? "connected"
          : "not_tested"
        : current.status;
  return integrationRepository.saveIntegration({
    id: current?.id ?? input.id ?? randomUUID(),
    provider: input.provider,
    name,
    config: {
      authType: "none",
      oauthConfigured: true,
      accountEmail: identityChanged
        ? null
        : (current?.config.accountEmail ?? null),
      accountName: identityChanged
        ? null
        : (current?.config.accountName ?? null),
    },
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status,
    lastTestedAt: identityChanged ? null : (current?.lastTestedAt ?? null),
    lastError: identityChanged ? null : (current?.lastError ?? null),
    enabled,
    permissions:
      input.permissions === undefined && current
        ? integrationRepository.listIntegrationPermissions(current.id)
        : normalizePermissions(input.provider, input.permissions),
    expectedVersion: input.expectedVersion,
    expectedAbsent: !current,
  });
}

function base64UrlSha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function startGoogleDataOAuth(
  integrationId: string,
  redirectUri: string,
) {
  const record = integrationRepository.getIntegrationRecord(integrationId);
  if (!record || !isGoogleDataProvider(record.provider)) {
    throw new IntegrationNotFoundError("Google integration not found.");
  }
  const credentials = parseCredentials(record);
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
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DATA_SCOPES[record.provider].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: base64UrlSha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function finishGoogleDataOAuth(state: string, code: string) {
  const pending = integrationRepository.consumeIntegrationOAuthState(state);
  if (!pending || !isGoogleDataProvider(pending.provider)) {
    throw new OperationalError("Google OAuth state is invalid or expired.");
  }
  const record = integrationRepository.getIntegrationRecord(
    pending.integrationId,
  );
  if (
    !record ||
    record.provider !== pending.provider ||
    record.version !== pending.integrationVersion
  ) {
    throw new OperationalError(
      "Google integration changed while authorization was in progress. Start authorization again.",
    );
  }
  const credentials = parseCredentials(record);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: pending.redirectUri,
        grant_type: "authorization_code",
        code_verifier: decryptLocalSecret(pending.verifierCiphertext),
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
    const refreshToken = body?.refresh_token ?? credentials.refreshToken;
    if (!response.ok || !body?.access_token || !refreshToken) {
      throw new OperationalError(
        `Google OAuth returned HTTP ${response.status}. Verify the OAuth app, enabled API, callback URL, and consent settings.`,
      );
    }
    const nextCredentials: GoogleDataCredentials = {
      ...credentials,
      accessToken: body.access_token,
      refreshToken,
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
    const adapter = createAdapter(staged, nextCredentials);
    await adapter.test();
    const identity: { email?: string } = await adapter
      .accountIdentity()
      .catch(() => ({}));
    const testedAt = new Date().toISOString();
    const completed = integrationRepository.completeGoogleDataOAuth({
      id: record.id,
      provider: record.provider,
      expectedVersion: pending.integrationVersion,
      credentialsCiphertext: staged.credentialsCiphertext,
      accountEmail:
        identity && typeof identity.email === "string"
          ? identity.email
          : undefined,
      testedAt,
    });
    if (!completed) {
      throw new IntegrationVersionConflictError(
        "Google integration changed while authorization was in progress. Start authorization again.",
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
          "Google authorization failed. Verify the OAuth app, enabled API, callback URL, account access, and consent settings.",
      },
    );
    throw error;
  }
}

export async function testGoogleDataIntegration(id: string) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || !isGoogleDataProvider(record.provider)) {
    throw new IntegrationNotFoundError("Google integration not found.");
  }
  const testedAt = new Date().toISOString();
  try {
    await createAdapter(record).test();
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: record.enabled ? "connected" : "disabled",
        lastTestedAt: testedAt,
        lastError: null,
      },
    );
    if (!updated) throw new IntegrationVersionConflictError();
    return updated;
  } catch (error) {
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: "failed",
        lastTestedAt: testedAt,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Google connection failed.",
      },
    );
    if (!updated) throw new IntegrationVersionConflictError();
    return updated;
  }
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function tokenMatches(value: string, expectedHash: string) {
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getRunGoogleDataRuntimeAccess(
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
  ) {
    return { status: "unauthorized" as const };
  }
  const record = integrationRepository.getIntegrationRecord(integrationId);
  if (!record || !isGoogleDataProvider(record.provider)) {
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
      `${record.provider}_${record.slug}`,
      capability.allowedTools,
    ),
  };
}

export function getAgentGoogleDataIntegrationsMcp(
  agentId: string,
  runId: string,
) {
  return withImmediateTransaction(() => {
    const existing = integrationRepository
      .listRunIntegrationCapabilities(runId)
      .filter((capability) => {
        const integration = integrationRepository.getIntegrationRecord(
          capability.integrationId,
        );
        return integration ? isGoogleDataProvider(integration.provider) : false;
      });
    const captured = integrationRepository.hasRunIntegrationSnapshot(
      runId,
      "google_data",
    );
    const captureFromLive = !captured && existing.length === 0;
    if (!captured) {
      integrationRepository.markRunIntegrationSnapshot(runId, "google_data");
    }
    const candidates = captureFromLive
      ? listGoogleDataIntegrations().map((integration) => ({
          integration,
          allowedTools:
            integrationRepository.listIntegrationPermissions(integration.id)[
              agentId
            ] ?? [],
          version: integration.version ?? 1,
        }))
      : existing
          .filter((capability) => capability.agentId === agentId)
          .map((capability) => ({
            integration: integrationRepository.getIntegration(
              capability.integrationId,
            ),
            allowedTools: capability.allowedTools,
            version: capability.integrationVersion,
          }));
    return candidates.flatMap(({ integration, allowedTools, version }) => {
      if (
        !integration ||
        !isGoogleDataProvider(integration.provider) ||
        !integration.enabled ||
        integration.status !== "connected"
      ) {
        return [];
      }
      const valid = new Set<string>(GOOGLE_DATA_TOOL_KEYS[integration.provider]);
      const allowed = allowedTools.filter((tool) => valid.has(tool));
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
            name: `${integration.provider}_${integration.slug}`,
            url: internalRoute(
              `/api/integrations/${encodeURIComponent(integration.id)}/mcp?run=${encodeURIComponent(runId)}`,
            ),
            credentials: { bearerToken: token },
            approval: { defaultMode: "approve" as const, tools: {} },
          },
          snapshot: {
            integrationId: integration.id,
            provider: integration.provider,
            name: integration.name,
            version: capability.integrationVersion,
            tools: capability.allowedTools,
          },
        },
      ];
    });
  });
}
