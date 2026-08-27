import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { filterToolsByRunPolicy } from "@/lib/agent-tool-policy";
import type { IntegrationRecord } from "@/lib/repositories/integration-repository";

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { discoverMcpTools } from "@/lib/mcp/client";
import { POSTHOG_TOOLS } from "@/lib/integrations/catalog";
import {
  canReuseHttpCredential,
  extractHttpPathParameters,
  normalizeHttpIntegrationBaseUrl,
  normalizeHttpOperationKey,
  normalizeHttpOperationPath,
} from "@/lib/integrations/http-contract";
import {
  testPostHogConnection,
  type PostHogDatacenter,
} from "@/lib/integrations/posthog";
import { internalRoute } from "@/lib/server-config";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import type {
  Integration,
  IntegrationAuthType,
  IntegrationHttpOperation,
  IntegrationOperationParameter,
  IntegrationMcpTool,
} from "@/lib/types";
import { compileMcpInputSchema } from "@/lib/integrations/json-schema";
import {
  normalizeIntegrationSlug,
  normalizeIntegrationToolKey,
} from "@/lib/integrations/naming";
import {
  IntegrationConfigurationError,
  IntegrationNotFoundError,
  IntegrationVersionConflictError,
} from "@/lib/integrations/errors";
import { redactIntegrationText } from "@/lib/integrations/redaction";

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024;
const OPERATION_MAX_RESPONSE_BYTES = 1024 * 1024;
const OPERATION_MIN_RESPONSE_BYTES = 64;

type CustomCredentials = {
  mcpToken: string;
  authSecret?: string;
};

type PosthogCredentials = {
  apiKey: string;
  mcpToken: string;
};

function randomAuthToken() {
  return randomUUID();
}

function assertExpectedVersion(
  current: IntegrationRecord | null,
  expectedVersion?: number,
  required = false,
) {
  if (required && expectedVersion === undefined) {
    throw new IntegrationConfigurationError(
      "expectedVersion is required when updating an integration.",
    );
  }
  if (
    expectedVersion !== undefined &&
    (!current || current.version !== expectedVersion)
  ) {
    throw new IntegrationVersionConflictError();
  }
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.trunc(value)));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return fallback;
}

function normalizeAuthType(value: IntegrationAuthType | undefined | null) {
  return value === "api_key_header" || value === "bearer" ? value : "none";
}

function normalizeAuthHeaderName(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "X-API-Key";
  return trimmed.replace(/[\r\n]/g, "").slice(0, 64);
}

function readPosthogCredentials(record: IntegrationRecord): PosthogCredentials {
  const decrypted = decryptLocalSecret(record.credentialsCiphertext);
  const parsed = JSON.parse(decrypted) as Partial<PosthogCredentials>;
  if (!parsed.apiKey || !parsed.mcpToken) {
    throw new Error("Stored PostHog credentials could not be read.");
  }
  return { apiKey: parsed.apiKey, mcpToken: parsed.mcpToken };
}

function readCustomCredentials(record: IntegrationRecord): CustomCredentials {
  const decrypted = decryptLocalSecret(record.credentialsCiphertext);
  const parsed = JSON.parse(decrypted) as {
    mcpToken?: string;
    authSecret?: string;
  };
  if (!parsed.mcpToken) {
    throw new Error("Stored custom integration credentials could not be read.");
  }
  return { mcpToken: parsed.mcpToken, authSecret: parsed.authSecret };
}

function normalizeHttpMethod(method: string) {
  const normalized = method.toUpperCase().trim();
  return normalized === "HEAD" ? "HEAD" : "GET";
}

function normalizeParameterType(
  type: IntegrationOperationParameter["type"] | undefined,
): IntegrationOperationParameter["type"] {
  if (type === "number" || type === "boolean" || type === "integer") {
    return type;
  }
  return "string";
}

function normalizeParameterName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function sanitizeParameters(
  parameters: Array<
    Partial<
      Pick<
        IntegrationOperationParameter,
        "name" | "location" | "type" | "required" | "description"
      >
    >
  >,
): IntegrationOperationParameter[] {
  if (!Array.isArray(parameters)) return [];
  const result: IntegrationOperationParameter[] = [];
  const seen = new Set<string>();

  for (const parameter of parameters) {
    const name = normalizeParameterName(parameter.name ?? "");
    if (!name) continue;
    if (seen.has(name)) continue;

    const location = parameter.location === "path" ? "path" : "query";
    result.push({
      name,
      location,
      type: normalizeParameterType(parameter.type),
      required: parameter.required === true,
      description:
        typeof parameter.description === "string"
          ? parameter.description.trim().slice(0, 240)
          : undefined,
    });
    seen.add(name);
  }

  return result;
}

function assertPathParameters(
  pathTemplate: string,
  parameters: IntegrationOperationParameter[],
) {
  const placeholders = extractHttpPathParameters(pathTemplate);
  const lookup = new Map(parameters.map((item) => [item.name, item]));

  for (const placeholder of placeholders) {
    const parameter = lookup.get(placeholder);
    if (!parameter) {
      throw new IntegrationConfigurationError(
        `Missing declaration for path parameter '{${placeholder}}'.`,
      );
    }
    if (parameter.location !== "path") {
      throw new IntegrationConfigurationError(
        `Path parameter '${placeholder}' must be declared with location=path.`,
      );
    }
    if (!parameter.required) {
      throw new IntegrationConfigurationError(
        `Path parameter '${placeholder}' must be marked as required.`,
      );
    }
  }

  for (const parameter of parameters) {
    if (
      parameter.location === "path" &&
      !placeholders.includes(parameter.name)
    ) {
      throw new IntegrationConfigurationError(
        `Path parameter '${parameter.name}' is not used in path '${pathTemplate}'.`,
      );
    }
  }
}

function toFullToolName(slug: string, key: string) {
  return `${normalizeIntegrationSlug(slug)}__${normalizeIntegrationToolKey(key)}`;
}

function normalizePermissionTools(
  provider: IntegrationRecord["provider"],
  integrationSlug: string,
  availableToolKeys: string[],
  permissions: Record<string, string[]>,
) {
  const available = new Set(availableToolKeys);
  const validAgentIds = new Set(
    agentRepository.listAgents().map((agent) => agent.id),
  );

  const result: Record<string, string[]> = {};
  for (const [agentId, requestedTools] of Object.entries(permissions ?? {})) {
    if (!validAgentIds.has(agentId) || !Array.isArray(requestedTools)) continue;

    const normalized = requestedTools
      .map((raw) => normalizeIntegrationToolKey(String(raw)))
      .filter((toolKey) => toolKey.length > 0)
      .map((toolKey) => {
        if (toolKey.includes("__") || provider === "posthog") return toolKey;
        return toFullToolName(integrationSlug, toolKey);
      })
      .filter((toolKey) => available.has(toolKey));

    const unique = [...new Set(normalized)];
    if (unique.length > 0) {
      result[agentId] = unique;
    }
  }

  return result;
}

function normalizePosthogPermissions(permissions: Record<string, string[]>) {
  const validTools = new Set(POSTHOG_TOOLS.map((tool) => tool.key));
  const validAgentIds = new Set(
    agentRepository.listAgents().map((agent) => agent.id),
  );
  return Object.fromEntries(
    Object.entries(permissions)
      .filter(([agentId]) => validAgentIds.has(agentId))
      .map(([agentId, toolKeys]) => [
        agentId,
        [...new Set(toolKeys)].filter((toolKey) => validTools.has(toolKey)),
      ])
      .filter(([, toolKeys]) => (toolKeys as string[]).length > 0),
  ) as Record<string, string[]>;
}

function buildAuthHeaders(
  authType: IntegrationAuthType,
  authHeaderName: string | null,
  authSecret?: string,
) {
  const headers: Record<string, string> = {};
  if (authType === "none" || !authSecret) return headers;
  if (authType === "bearer") {
    headers.Authorization = `Bearer ${authSecret}`;
    return headers;
  }
  const name = normalizeAuthHeaderName(authHeaderName);
  headers[name] = authSecret;
  return headers;
}

function mapMcpTools(rawTools: Array<Record<string, unknown>>) {
  const exposedNames = new Set<string>();
  return rawTools.map((tool): IntegrationMcpTool => {
    const name = String(tool.name ?? "").trim();
    const exposedName = normalizeIntegrationToolKey(name);
    if (!name || !exposedName) {
      throw new Error("The MCP server returned a tool without a valid name.");
    }
    if (exposedNames.has(exposedName)) {
      throw new Error(
        `MCP tool name collision after normalization: '${name}'.`,
      );
    }
    exposedNames.add(exposedName);
    const annotations = (tool.annotations ?? {}) as Record<string, unknown>;

    const inputSchema = (tool.inputSchema as Record<string, unknown>) ?? {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    compileMcpInputSchema(inputSchema);
    return {
      name,
      description:
        typeof tool.description === "string" ? tool.description : null,
      inputSchema,
      readOnlyHint: Boolean(annotations.readOnlyHint),
      destructiveHint: Boolean(annotations.destructiveHint),
      idempotentHint:
        annotations.idempotentHint == null
          ? null
          : Boolean(annotations.idempotentHint),
      openWorldHint:
        annotations.openWorldHint == null
          ? null
          : Boolean(annotations.openWorldHint),
    };
  });
}

type CustomHttpOperationInput = {
  id?: string;
  key: string;
  name: string;
  description?: string;
  method?: "GET" | "HEAD";
  path: string;
  parameters?: Array<
    Partial<
      Pick<
        IntegrationOperationParameter,
        "name" | "location" | "type" | "required" | "description"
      >
    >
  >;
  responsePath?: string;
  maxResponseBytes?: number | null;
  maxItems?: number | null;
  timeoutMs?: number | null;
  enabled?: boolean;
};

function normalizeCustomHttpOperations(
  operations: CustomHttpOperationInput[],
  defaultTimeoutMs: number,
  integrationName: string,
): IntegrationHttpOperation[] {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new IntegrationConfigurationError(
      "At least one operation is required for a custom HTTP integration.",
    );
  }

  const normalized: IntegrationHttpOperation[] = [];
  const seen = new Set<string>();

  for (const raw of operations) {
    const operationName = String(raw?.name || "").trim() || integrationName;
    const rawKey = String(raw?.key || operationName).trim();
    const key = normalizeHttpOperationKey(rawKey);
    if (!key) {
      throw new IntegrationConfigurationError("Each operation needs a key.");
    }
    if (seen.has(key)) {
      throw new IntegrationConfigurationError(
        `Operation key duplicated: ${key}`,
      );
    }
    seen.add(key);

    const path = normalizeHttpOperationPath(raw.path || `/${key}`);
    const parameters = sanitizeParameters(raw.parameters || []);
    assertPathParameters(path, parameters);

    normalized.push({
      id: raw.id || randomUUID(),
      integrationId: "",
      key,
      name: operationName,
      description: (raw.description || "").trim().slice(0, 240),
      method: normalizeHttpMethod(raw.method || "GET"),
      path,
      parameters,
      responsePath:
        typeof raw.responsePath === "string" && raw.responsePath.trim()
          ? raw.responsePath.trim()
          : undefined,
      maxResponseBytes: clampNumber(
        raw.maxResponseBytes,
        DEFAULT_MAX_RESPONSE_BYTES,
        OPERATION_MIN_RESPONSE_BYTES,
        OPERATION_MAX_RESPONSE_BYTES,
      ),
      maxItems:
        raw.maxItems != null ? clampNumber(raw.maxItems, 50, 1, 500) : null,
      timeoutMs:
        raw.timeoutMs != null
          ? clampNumber(raw.timeoutMs, defaultTimeoutMs, 1_000, 120_000)
          : defaultTimeoutMs,
      enabled: raw.enabled !== false,
      createdAt: raw.path ? new Date().toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return normalized;
}

export async function savePostHogIntegration(input: {
  id?: string;
  expectedVersion?: number;
  apiKey?: string;
  datacenter: PostHogDatacenter;
  permissions: Record<string, string[]>;
  enabled?: boolean;
}): Promise<Integration> {
  const current = input.id
    ? integrationRepository.getIntegrationRecord(input.id)
    : integrationRepository.getIntegrationRecordByProvider("posthog");
  if (!input.id && current) throw new IntegrationVersionConflictError();
  assertExpectedVersion(current, input.expectedVersion, Boolean(input.id));

  let previous: PosthogCredentials | null = null;
  if (current) {
    try {
      previous = readPosthogCredentials(current);
    } catch {
      previous = null;
    }
  }

  const apiKey = input.apiKey?.trim() || previous?.apiKey;
  if (!apiKey) {
    throw new IntegrationConfigurationError(
      "A PostHog personal API key is required.",
    );
  }

  const credentials: PosthogCredentials = {
    apiKey,
    mcpToken: previous?.mcpToken ?? randomAuthToken(),
  };

  const testedAt = new Date().toISOString();
  let status: IntegrationRecord["status"] = "connected";
  let lastError: string | null = null;
  try {
    await testPostHogConnection(input.datacenter, apiKey);
  } catch (error) {
    status = "failed";
    lastError = redactIntegrationText(
      error instanceof Error ? error.message : "PostHog connection failed.",
      [apiKey],
    );
  }
  if (input.enabled === false) status = "disabled";

  return integrationRepository.saveIntegration({
    id: current?.id,
    provider: "posthog",
    name: "PostHog",
    config: {
      datacenter: input.datacenter,
      authType: "none",
    },
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status,
    lastTestedAt: testedAt,
    lastError,
    permissions: normalizePosthogPermissions(input.permissions),
    enabled: input.enabled ?? current?.enabled ?? true,
    expectedVersion: input.expectedVersion ?? current?.version,
    expectedAbsent: !current,
  });
}

export async function saveCustomHttpIntegration(input: {
  id?: string;
  expectedVersion?: number;
  name: string;
  baseUrl: string;
  authType: IntegrationAuthType;
  authHeaderName?: string | null;
  timeoutMs?: number | null;
  secret?: string;
  enabled?: boolean;
  permissions: Record<string, string[]>;
  operations: CustomHttpOperationInput[];
}): Promise<Integration> {
  const name = input.name.trim();
  if (!name) {
    throw new IntegrationConfigurationError("Integration name is required.");
  }

  const baseUrl = normalizeHttpIntegrationBaseUrl(input.baseUrl);
  const authType = normalizeAuthType(input.authType);
  const current = input.id
    ? integrationRepository.getIntegrationRecord(input.id)
    : null;
  assertExpectedVersion(current, input.expectedVersion, Boolean(input.id));

  if (current && current.provider !== "custom_http") {
    throw new IntegrationVersionConflictError("Integration type mismatch.");
  }
  const slug = current?.slug ?? normalizeIntegrationSlug(name);

  const timeout = clampNumber(
    input.timeoutMs,
    DEFAULT_HTTP_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const operations = normalizeCustomHttpOperations(
    input.operations || [],
    timeout,
    name,
  );

  let previousSecret: CustomCredentials | null = null;
  if (current) {
    try {
      previousSecret = readCustomCredentials(current);
    } catch {
      previousSecret = null;
    }
  }

  const canReuseSecret = Boolean(
    current?.config.baseUrl &&
    previousSecret?.authSecret &&
    canReuseHttpCredential(
      {
        baseUrl: current.config.baseUrl,
        authType: normalizeAuthType(
          current.config.authType ?? current.authType,
        ),
        authHeaderName: current.config.authHeaderName ?? current.authHeaderName,
      },
      { baseUrl, authType, authHeaderName: input.authHeaderName },
    ),
  );
  const authSecret =
    authType === "none"
      ? undefined
      : (
          input.secret ??
          (canReuseSecret ? previousSecret?.authSecret : undefined)
        )?.trim();
  if (authType !== "none" && !authSecret) {
    throw new IntegrationConfigurationError(
      current && previousSecret?.authSecret
        ? "Replace the authentication secret after changing the connector origin or authentication settings."
        : "Authentication secret is required for this integration.",
    );
  }

  const credentials: CustomCredentials = {
    mcpToken: previousSecret?.mcpToken ?? randomAuthToken(),
    ...(authSecret ? { authSecret } : {}),
  };

  const testedAt = new Date().toISOString();
  let status: IntegrationRecord["status"] = "connected";
  let lastError: string | null = null;
  try {
    const response = await fetch(baseUrl, {
      method: "HEAD",
      headers: buildAuthHeaders(
        authType,
        input.authHeaderName ?? null,
        authSecret,
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw new Error(
        `Custom HTTP integration test failed: ${response.status}`,
      );
    }
  } catch (error) {
    status = "failed";
    lastError = redactIntegrationText(
      error instanceof Error
        ? error.message
        : "Custom HTTP integration connection failed.",
      authSecret ? [authSecret] : [],
    );
  }
  if (input.enabled === false) status = "disabled";

  const slugTools = operations.map((operation) =>
    toFullToolName(slug, operation.key),
  );
  const permissions = normalizePermissionTools(
    "custom_http",
    slug,
    slugTools,
    input.permissions,
  );

  return integrationRepository.saveIntegration({
    id: current?.id,
    provider: "custom_http",
    name,
    config: {
      baseUrl,
      authType,
      authHeaderName:
        authType === "api_key_header"
          ? normalizeAuthHeaderName(input.authHeaderName)
          : null,
      timeoutMs: timeout,
    },
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status,
    lastTestedAt: testedAt,
    lastError,
    enabled: input.enabled ?? current?.enabled ?? true,
    permissions,
    operations,
    version: (current?.version ?? 0) + 1,
    expectedVersion: input.expectedVersion ?? current?.version,
  });
}

export async function saveCustomMcpIntegration(input: {
  id?: string;
  expectedVersion?: number;
  name: string;
  baseUrl: string;
  authType: IntegrationAuthType;
  authHeaderName?: string | null;
  timeoutMs?: number | null;
  secret?: string;
  enabled?: boolean;
  permissions: Record<string, string[]>;
}): Promise<Integration> {
  const name = input.name.trim();
  if (!name) {
    throw new IntegrationConfigurationError("Integration name is required.");
  }

  const baseUrl = normalizeHttpIntegrationBaseUrl(input.baseUrl);
  const authType = normalizeAuthType(input.authType);
  const timeout = clampNumber(
    input.timeoutMs,
    DEFAULT_HTTP_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const current = input.id
    ? integrationRepository.getIntegrationRecord(input.id)
    : null;
  assertExpectedVersion(current, input.expectedVersion, Boolean(input.id));

  if (current && current.provider !== "custom_mcp") {
    throw new IntegrationVersionConflictError("Integration type mismatch.");
  }
  const slug = current?.slug ?? normalizeIntegrationSlug(name);

  let previousSecret: CustomCredentials | null = null;
  if (current) {
    try {
      previousSecret = readCustomCredentials(current);
    } catch {
      previousSecret = null;
    }
  }

  const canReuseSecret = Boolean(
    current?.config.baseUrl &&
    previousSecret?.authSecret &&
    canReuseHttpCredential(
      {
        baseUrl: current.config.baseUrl,
        authType: normalizeAuthType(
          current.config.authType ?? current.authType,
        ),
        authHeaderName: current.config.authHeaderName ?? current.authHeaderName,
      },
      { baseUrl, authType, authHeaderName: input.authHeaderName },
    ),
  );
  const authSecret =
    authType === "none"
      ? undefined
      : (
          input.secret ??
          (canReuseSecret ? previousSecret?.authSecret : undefined)
        )?.trim();
  if (authType !== "none" && !authSecret) {
    throw new IntegrationConfigurationError(
      current && previousSecret?.authSecret
        ? "Replace the authentication secret after changing the connector origin or authentication settings."
        : "Authentication secret is required for this integration.",
    );
  }

  const credentials: CustomCredentials = {
    mcpToken: previousSecret?.mcpToken ?? randomAuthToken(),
    ...(authSecret ? { authSecret } : {}),
  };

  let mcpTools: IntegrationMcpTool[] = [];
  const testedAt = new Date().toISOString();
  let status: IntegrationRecord["status"] = "connected";
  let lastError: string | null = null;
  try {
    const result = await discoverMcpTools({
      url: baseUrl,
      headers: buildAuthHeaders(
        authType,
        input.authHeaderName ?? null,
        authSecret,
      ),
    });
    mcpTools = mapMcpTools(result as Array<Record<string, unknown>>);
  } catch (error) {
    status = "failed";
    lastError = redactIntegrationText(
      error instanceof Error
        ? error.message
        : "Custom MCP integration connection failed.",
      authSecret ? [authSecret] : [],
    );
  }
  if (input.enabled === false) status = "disabled";

  const permissions = normalizePermissionTools(
    "custom_mcp",
    slug,
    mcpTools.map((tool) => toFullToolName(slug, tool.name)),
    input.permissions,
  );

  return integrationRepository.saveIntegration({
    id: current?.id,
    provider: "custom_mcp",
    name,
    config: {
      baseUrl,
      authType,
      authHeaderName:
        authType === "api_key_header"
          ? normalizeAuthHeaderName(input.authHeaderName)
          : null,
      timeoutMs: timeout,
    },
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status,
    lastTestedAt: testedAt,
    lastError,
    enabled: input.enabled ?? current?.enabled ?? true,
    permissions,
    mcpTools,
    version: (current?.version ?? 0) + 1,
    expectedVersion: input.expectedVersion ?? current?.version,
  });
}

export async function retestPostHogIntegration(id: string) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || record.provider !== "posthog") {
    throw new IntegrationNotFoundError("PostHog integration not found.");
  }

  const testedAt = new Date().toISOString();
  let credentials: PosthogCredentials;
  try {
    credentials = readPosthogCredentials(record);
  } catch {
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: "failed",
        lastTestedAt: testedAt,
        lastError: "Stored PostHog credentials could not be read.",
      },
    );
    if (!updated) throw new IntegrationVersionConflictError();
    return updated;
  }
  try {
    await testPostHogConnection(
      record.config.datacenter ?? "us",
      credentials.apiKey,
    );
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: record.enabled ? "connected" : "disabled",
        lastTestedAt: testedAt,
        lastError: null,
      },
    );
    if (!updated)
      throw new IntegrationVersionConflictError(
        "Integration changed while the connection test was running. Test the current configuration again.",
      );
    return updated;
  } catch (error) {
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: "failed",
        lastTestedAt: testedAt,
        lastError: redactIntegrationText(
          error instanceof Error ? error.message : "PostHog connection failed.",
          [credentials.apiKey],
        ),
      },
    );
    if (!updated)
      throw new IntegrationVersionConflictError(
        "Integration changed while the connection test was running. Test the current configuration again.",
      );
    return updated;
  }
}

export async function retestCustomHttpIntegration(id: string) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || record.provider !== "custom_http") {
    throw new IntegrationNotFoundError("Custom HTTP integration not found.");
  }

  const credentials = readCustomCredentials(record);
  const testedAt = new Date().toISOString();
  try {
    const response = await fetch(String(record.config.baseUrl), {
      method: "HEAD",
      headers: buildAuthHeaders(
        record.config.authType ?? "none",
        record.config.authHeaderName ?? null,
        credentials.authSecret,
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw new Error(
        `Custom HTTP integration test failed: ${response.status}`,
      );
    }

    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: record.enabled ? "connected" : "disabled",
        lastTestedAt: testedAt,
        lastError: null,
      },
    );
    if (!updated)
      throw new IntegrationVersionConflictError(
        "Integration changed while the connection test was running. Test the current configuration again.",
      );
    return updated;
  } catch (error) {
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: "failed",
        lastTestedAt: testedAt,
        lastError: redactIntegrationText(
          error instanceof Error
            ? error.message
            : "Custom HTTP integration connection failed.",
          credentials.authSecret ? [credentials.authSecret] : [],
        ),
      },
    );
    if (!updated)
      throw new IntegrationVersionConflictError(
        "Integration changed while the connection test was running. Test the current configuration again.",
      );
    return updated;
  }
}

export async function retestCustomMcpIntegration(id: string) {
  const record = integrationRepository.getIntegrationRecord(id);
  if (!record || record.provider !== "custom_mcp") {
    throw new IntegrationNotFoundError("Custom MCP integration not found.");
  }

  const credentials = readCustomCredentials(record);
  const testedAt = new Date().toISOString();
  try {
    const discovered = await discoverMcpTools({
      url: String(record.config.baseUrl),
      headers: buildAuthHeaders(
        record.config.authType ?? "none",
        record.config.authHeaderName ?? null,
        credentials.authSecret,
      ),
    });
    const mcpTools = mapMcpTools(discovered as Array<Record<string, unknown>>);
    const permissions = normalizePermissionTools(
      "custom_mcp",
      record.slug,
      mcpTools.map((tool) => toFullToolName(record.slug, tool.name)),
      integrationRepository.listIntegrationPermissions(record.id),
    );

    return integrationRepository.saveIntegration({
      id: record.id,
      provider: "custom_mcp",
      name: record.name,
      config: record.config,
      credentialsCiphertext: record.credentialsCiphertext,
      status: record.enabled ? "connected" : "disabled",
      lastTestedAt: testedAt,
      lastError: null,
      permissions,
      mcpTools,
      enabled: record.enabled,
      version: record.version + 1,
      expectedVersion: record.version,
    });
  } catch (error) {
    const updated = integrationRepository.updateIntegrationCheckIfVersion(
      id,
      record.version,
      {
        status: "failed",
        lastTestedAt: testedAt,
        lastError: redactIntegrationText(
          error instanceof Error
            ? error.message
            : "Custom MCP integration connection failed.",
          credentials.authSecret ? [credentials.authSecret] : [],
        ),
      },
    );
    if (!updated)
      throw new IntegrationVersionConflictError(
        "Integration changed while the connection test was running. Test the current configuration again.",
      );
    return updated;
  }
}

export function getPostHogRuntimeAccess(
  integrationId: string,
  agentId: string,
) {
  const record = integrationRepository.getIntegrationRecord(integrationId);
  if (
    !record ||
    record.provider !== "posthog" ||
    record.status !== "connected" ||
    !record.enabled
  ) {
    return null;
  }

  const allowedTools =
    integrationRepository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;

  return {
    record,
    credentials: readPosthogCredentials(record),
    allowedTools,
  };
}

export function getAgentPostHogMcp(agentId: string) {
  const record =
    integrationRepository.getIntegrationRecordByProvider("posthog");
  if (!record || record.status !== "connected" || !record.enabled) return null;

  const allowedTools =
    integrationRepository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;

  const credentials = readPosthogCredentials(record);

  return {
    name: "work_posthog" as const,
    url: internalRoute(
      `/api/integrations/${encodeURIComponent(record.id)}/mcp?agent=${encodeURIComponent(agentId)}`,
    ),
    credentials: { bearerToken: credentials.mcpToken },
  };
}

function hashCapabilityToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function capabilityTokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashCapabilityToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type RunCustomIntegrationAccess =
  | {
      status: "ok";
      record: IntegrationRecord;
      credentials: CustomCredentials;
      allowedTools: string[];
      integrationVersion: number;
    }
  | {
      status: "stale";
      integrationVersion: number;
      currentVersion: number;
    }
  | { status: "unauthorized" };

export function getRunCustomIntegrationRuntimeAccess(
  integrationId: string,
  runId: string,
  token: string,
): RunCustomIntegrationAccess {
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
    !capabilityTokenMatches(token, capability.tokenHash)
  ) {
    return { status: "unauthorized" };
  }

  const record = integrationRepository.getIntegrationRecord(integrationId);
  if (
    !record ||
    (record.provider !== "custom_http" && record.provider !== "custom_mcp")
  ) {
    return { status: "unauthorized" };
  }
  if (record.version !== capability.integrationVersion) {
    return {
      status: "stale",
      integrationVersion: capability.integrationVersion,
      currentVersion: record.version,
    };
  }

  return {
    status: "ok",
    record,
    credentials: readCustomCredentials(record),
    allowedTools: filterToolsByRunPolicy(
      runId,
      `${record.provider}_${record.slug}`,
      capability.allowedTools,
    ),
    integrationVersion: capability.integrationVersion,
  };
}

export function getAgentCustomIntegrationsMcp(agentId: string, runId: string) {
  return withImmediateTransaction(() => {
    const existing = integrationRepository
      .listRunIntegrationCapabilities(runId)
      .filter((capability) => {
        const integration = integrationRepository.getIntegrationRecord(
          capability.integrationId,
        );
        return (
          integration?.provider === "custom_http" ||
          integration?.provider === "custom_mcp"
        );
      });
    const alreadyCaptured = integrationRepository.hasRunIntegrationSnapshot(
      runId,
      "custom",
    );
    const captureFromLive = !alreadyCaptured && existing.length === 0;
    if (!alreadyCaptured)
      integrationRepository.markRunIntegrationSnapshot(runId, "custom");
    const candidates = captureFromLive
      ? integrationRepository
          .listIntegrations()
          .filter(
            (integration) =>
              integration.enabled &&
              integration.status === "connected" &&
              (integration.provider === "custom_http" ||
                integration.provider === "custom_mcp"),
          )
          .map((integration) => ({
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
        allowedTools.length === 0 ||
        (integration.provider !== "custom_http" &&
          integration.provider !== "custom_mcp")
      ) {
        return [];
      }
      const token = randomBytes(32).toString("base64url");
      const capability = integrationRepository.saveRunIntegrationCapability({
        runId,
        integrationId: integration.id,
        agentId,
        integrationVersion: version,
        tokenHash: hashCapabilityToken(token),
        allowedTools,
      });
      return [
        {
          server: {
            name: `${integration.provider}_${integration.slug}`,
            url: internalRoute(
              `/api/integrations/${encodeURIComponent(integration.id)}/mcp?run=${encodeURIComponent(runId)}`,
            ),
            credentials: { bearerToken: token },
            ...(integration.provider === "custom_http"
              ? {
                  approval: {
                    defaultMode: "approve" as const,
                    tools: {},
                  },
                }
              : {}),
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
