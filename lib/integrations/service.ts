import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { inspectMcpDefinitions } from "@/lib/mcp/client";
import { POSTHOG_TOOLS } from "@/lib/integrations/catalog";
import {
  testPostHogConnection,
  type PostHogDatacenter,
} from "@/lib/integrations/posthog";
import { repository, type IntegrationRecord } from "@/lib/repository";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import type {
  Integration,
  IntegrationAuthType,
  IntegrationHttpOperation,
  IntegrationOperationParameter,
  IntegrationMcpTool,
} from "@/lib/types";

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024;
const OPERATION_MAX_RESPONSE_BYTES = 1024 * 1024;
const OPERATION_MIN_RESPONSE_BYTES = 64;

function randomToken() {
  return randomBytes(24).toString("base64url");
}

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

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "integration";
}

function normalizeToolKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
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
  return value === "api_key_header" || value === "bearer"
    ? value
    : "none";
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

function ensureHttpUrl(value: string) {
  const parsed = new URL(value.trim());
  if (!parsed.protocol || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("Base URL must not include query, hash, or credentials.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function ensureOperationPath(path: string) {
  const value = path.trim();
  if (!value.startsWith("/")) {
    throw new Error("Operation path must start with '/'.");
  }
  if (value.includes("..")) {
    throw new Error("Operation path cannot contain '..'.");
  }
  if (/[^a-zA-Z0-9_\-/.{}]/.test(value)) {
    throw new Error("Operation path contains invalid characters.");
  }
  return value;
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

function sanitizeParameters(
  parameters: Array<
    Partial<Pick<IntegrationOperationParameter, "name" | "location" | "type" | "required" | "description">>
  >,
): IntegrationOperationParameter[] {
  if (!Array.isArray(parameters)) return [];
  const result: IntegrationOperationParameter[] = [];
  const seen = new Set<string>();

  for (const parameter of parameters) {
    const name = normalizeToolKey(parameter.name ?? "");
    if (!name) continue;
    if (seen.has(name)) continue;

    const location =
      parameter.location === "path"
        ? "path"
        : "query";
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

function extractPathParameters(pathTemplate: string) {
  const items = new Set<string>();
  const matcher = /\{([a-zA-Z0-9_-]+)\}/g;
  for (const match of pathTemplate.matchAll(matcher)) {
    items.add(match[1]);
  }
  return [...items];
}

function assertPathParameters(
  pathTemplate: string,
  parameters: IntegrationOperationParameter[],
) {
  const placeholders = extractPathParameters(pathTemplate);
  const lookup = new Map(parameters.map((item) => [item.name, item]));

  for (const placeholder of placeholders) {
    const parameter = lookup.get(placeholder);
    if (!parameter) {
      throw new Error(`Missing declaration for path parameter '{${placeholder}}'.`);
    }
    if (parameter.location !== "path") {
      throw new Error(
        `Path parameter '${placeholder}' must be declared with location=path.`,
      );
    }
    if (!parameter.required) {
      throw new Error(
        `Path parameter '${placeholder}' must be marked as required.`,
      );
    }
  }

  for (const parameter of parameters) {
    if (parameter.location === "path" && !placeholders.includes(parameter.name)) {
      throw new Error(
        `Path parameter '${parameter.name}' is not used in path '${pathTemplate}'.`,
      );
    }
  }
}

function toFullToolName(slug: string, key: string) {
  return `${normalizeSlug(slug)}__${normalizeToolKey(key)}`;
}

function normalizePermissionTools(
  provider: IntegrationRecord["provider"],
  integrationSlug: string,
  availableToolKeys: string[],
  permissions: Record<string, string[]>,
) {
  const available = new Set(availableToolKeys);
  const validAgentIds = new Set(repository.listAgents().map((agent) => agent.id));

  const result: Record<string, string[]> = {};
  for (const [agentId, requestedTools] of Object.entries(permissions ?? {})) {
    if (!validAgentIds.has(agentId) || !Array.isArray(requestedTools)) continue;

    const normalized = requestedTools
      .map((raw) => normalizeToolKey(String(raw)))
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
  return Object.fromEntries(
    Object.entries(permissions)
      .filter(([agentId]) =>
        repository.listAgents().some((agent) => agent.id === agentId),
      )
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
  return rawTools.map((tool): IntegrationMcpTool => {
    const annotations = (tool.annotations ?? {}) as Record<string, unknown>;

    return {
      name: String(tool.name),
      description: typeof tool.description === "string" ? tool.description : null,
      inputSchema:
        (tool.inputSchema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
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
      >>
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
    throw new Error("At least one operation is required for a custom HTTP integration.");
  }

  const normalized: IntegrationHttpOperation[] = [];
  const seen = new Set<string>();

  for (const raw of operations) {
    const operationName = String(raw?.name || "").trim() || integrationName;
    const rawKey = String(raw?.key || operationName).trim();
    const key = normalizeToolKey(rawKey);
    if (!key) {
      throw new Error("Each operation needs a key.");
    }
    if (seen.has(key)) {
      throw new Error(`Operation key duplicated: ${key}`);
    }
    seen.add(key);

    const path = ensureOperationPath(raw.path || `/${key}`);
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
        raw.maxItems != null
          ? clampNumber(raw.maxItems, 50, 1, 500)
          : null,
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
  apiKey?: string;
  datacenter: PostHogDatacenter;
  permissions: Record<string, string[]>;
}): Promise<Integration> {
  const current = input.id
    ? repository.getIntegrationRecord(input.id)
    : repository.getIntegrationRecordByProvider("posthog");

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
    throw new Error("A PostHog personal API key is required.");
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
    lastError =
      error instanceof Error ? error.message : "PostHog connection failed.";
  }

  return repository.saveIntegration({
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
    enabled: input.id ? current?.enabled : true,
  });
}

export async function saveCustomHttpIntegration(input: {
  id?: string;
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
    throw new Error("Integration name is required.");
  }

  const slug = normalizeSlug(name);
  const baseUrl = ensureHttpUrl(input.baseUrl);
  const authType = normalizeAuthType(input.authType);
  const current = input.id
    ? repository.getIntegrationRecord(input.id)
    : null;

  if (current && current.provider !== "custom_http") {
    throw new Error("Integration type mismatch.");
  }

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

  const authSecret =
    authType === "none"
      ? undefined
      : (input.secret ?? previousSecret?.authSecret)?.trim();
  if (authType !== "none" && !authSecret) {
    throw new Error("Authentication secret is required for this integration.");
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
      headers: buildAuthHeaders(authType, input.authHeaderName ?? null, authSecret),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw new Error(`Custom HTTP integration test failed: ${response.status}`);
    }
  } catch (error) {
    status = "failed";
    lastError =
      error instanceof Error
        ? error.message
        : "Custom HTTP integration connection failed.";
  }

  const slugTools = operations.map((operation) => toFullToolName(slug, operation.key));
  const permissions = normalizePermissionTools(
    "custom_http",
    slug,
    slugTools,
    input.permissions,
  );

  return repository.saveIntegration({
    id: current?.id,
    provider: "custom_http",
    name,
    config: {
      baseUrl,
      authType,
      authHeaderName:
        authType === "api_key_header" ? normalizeAuthHeaderName(input.authHeaderName) : null,
      timeoutMs: timeout,
    },
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status,
    lastTestedAt: testedAt,
    lastError,
    enabled: input.enabled ?? true,
    permissions,
    operations,
    version: (current?.version ?? 0) + 1,
  });
}

export async function saveCustomMcpIntegration(input: {
  id?: string;
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
    throw new Error("Integration name is required.");
  }

  const slug = normalizeSlug(name);
  const baseUrl = ensureHttpUrl(input.baseUrl);
  const authType = normalizeAuthType(input.authType);
  const timeout = clampNumber(
    input.timeoutMs,
    DEFAULT_HTTP_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const current = input.id
    ? repository.getIntegrationRecord(input.id)
    : null;

  if (current && current.provider !== "custom_mcp") {
    throw new Error("Integration type mismatch.");
  }

  let previousSecret: CustomCredentials | null = null;
  if (current) {
    try {
      previousSecret = readCustomCredentials(current);
    } catch {
      previousSecret = null;
    }
  }

  const authSecret =
    authType === "none"
      ? undefined
      : (input.secret ?? previousSecret?.authSecret)?.trim();
  if (authType !== "none" && !authSecret) {
    throw new Error("Authentication secret is required for this integration.");
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
    const result = await inspectMcpDefinitions("custom_mcp", {
      url: baseUrl,
      headers: buildAuthHeaders(authType, input.authHeaderName ?? null, authSecret),
    });
    if (!result.success) {
      throw new Error(result.error || "Could not inspect MCP tools.");
    }
    mcpTools = mapMcpTools(result.tools as Array<Record<string, unknown>>);
  } catch (error) {
    status = "failed";
    lastError =
      error instanceof Error
        ? error.message
        : "Custom MCP integration connection failed.";
  }

  const permissions = normalizePermissionTools(
    "custom_mcp",
    slug,
    mcpTools.map((tool) => toFullToolName(slug, tool.name)),
    input.permissions,
  );

  return repository.saveIntegration({
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
    enabled: input.enabled ?? true,
    permissions,
    mcpTools,
    version: (current?.version ?? 0) + 1,
  });
}

export async function retestPostHogIntegration(id: string) {
  const record = repository.getIntegrationRecord(id);
  if (!record || record.provider !== "posthog") {
    throw new Error("PostHog integration not found.");
  }

  const testedAt = new Date().toISOString();
  try {
    await testPostHogConnection(
      record.config.datacenter ?? "us",
      readPosthogCredentials(record).apiKey,
    );
    return repository.updateIntegrationCheck(id, {
      status: "connected",
      lastTestedAt: testedAt,
      lastError: null,
    })!;
  } catch (error) {
    return repository.updateIntegrationCheck(id, {
      status: "failed",
      lastTestedAt: testedAt,
      lastError:
        error instanceof Error ? error.message : "PostHog connection failed.",
    })!;
  }
}

export async function retestCustomHttpIntegration(id: string) {
  const record = repository.getIntegrationRecord(id);
  if (!record || record.provider !== "custom_http") {
    throw new Error("Custom HTTP integration not found.");
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
    });
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw new Error(`Custom HTTP integration test failed: ${response.status}`);
    }

    return repository.updateIntegrationCheck(id, {
      status: "connected",
      lastTestedAt: testedAt,
      lastError: null,
    })!;
  } catch (error) {
    return repository.updateIntegrationCheck(id, {
      status: "failed",
      lastTestedAt: testedAt,
      lastError:
        error instanceof Error
          ? error.message
          : "Custom HTTP integration connection failed.",
    })!;
  }
}

export async function retestCustomMcpIntegration(id: string) {
  const record = repository.getIntegrationRecord(id);
  if (!record || record.provider !== "custom_mcp") {
    throw new Error("Custom MCP integration not found.");
  }

  const credentials = readCustomCredentials(record);
  const testedAt = new Date().toISOString();
  try {
    const discovered = await inspectMcpDefinitions("custom_mcp", {
      url: String(record.config.baseUrl),
      headers: buildAuthHeaders(
        record.config.authType ?? "none",
        record.config.authHeaderName ?? null,
        credentials.authSecret,
      ),
    });
    if (!discovered.success) {
      throw new Error(discovered.error || "Could not inspect MCP tools.");
    }

    const mcpTools = mapMcpTools(discovered.tools as Array<Record<string, unknown>>);
    const permissions = normalizePermissionTools(
      "custom_mcp",
      record.slug,
      mcpTools.map((tool) => toFullToolName(record.slug, tool.name)),
      repository.listIntegrationPermissions(record.id),
    );

    return repository.saveIntegration({
      id: record.id,
      provider: "custom_mcp",
      name: record.name,
      config: record.config,
      credentialsCiphertext: record.credentialsCiphertext,
      status: "connected",
      lastTestedAt: testedAt,
      lastError: null,
      permissions,
      mcpTools,
      enabled: record.enabled,
    });
  } catch (error) {
    return repository.updateIntegrationCheck(id, {
      status: "failed",
      lastTestedAt: testedAt,
      lastError:
        error instanceof Error
          ? error.message
          : "Custom MCP integration connection failed.",
    })!;
  }
}

export function getPostHogRuntimeAccess(integrationId: string, agentId: string) {
  const record = repository.getIntegrationRecord(integrationId);
  if (
    !record ||
    record.provider !== "posthog" ||
    record.status !== "connected" ||
    !record.enabled
  ) {
    return null;
  }

  const allowedTools = repository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;

  return {
    record,
    credentials: readPosthogCredentials(record),
    allowedTools,
  };
}

export function getAgentPostHogMcp(agentId: string) {
  const record = repository.getIntegrationRecord("posthog");
  if (!record || record.status !== "connected" || !record.enabled) return null;

  const allowedTools = repository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;

  const credentials = readPosthogCredentials(record);
  const port = process.env.PORT?.trim() || "3009";

  return {
    name: "work_posthog" as const,
    url: `http://127.0.0.1:${port}/api/integrations/${encodeURIComponent(record.id)}/mcp?agent=${encodeURIComponent(agentId)}`,
    credentials: { bearerToken: credentials.mcpToken },
  };
}

export function getCustomIntegrationRuntimeAccess(
  integrationId: string,
  agentId: string,
) {
  const record = repository.getIntegrationRecord(integrationId);
  if (
    !record ||
    record.provider !== "custom_http" && record.provider !== "custom_mcp" ||
    record.status !== "connected" ||
    !record.enabled
  ) {
    return null;
  }

  const allowedTools = repository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;

  return {
    record,
    credentials: readCustomCredentials(record),
    allowedTools,
  };
}

export function getAgentCustomIntegrationsMcp(agentId: string) {
  const integrations = repository
    .listIntegrations()
    .filter(
      (integration) =>
        integration.enabled &&
        integration.status === "connected" &&
        (integration.provider === "custom_http" ||
          integration.provider === "custom_mcp") &&
        (repository.listIntegrationPermissions(integration.id)[agentId]?.length ?? 0) >
          0,
    );

  return integrations
    .map((integration) => {
      const access = getCustomIntegrationRuntimeAccess(integration.id, agentId);
      if (!access) return null;
      const port = process.env.PORT?.trim() || "3009";
      return {
        name: `${integration.provider}_${integration.slug}` as const,
        url: `http://127.0.0.1:${port}/api/integrations/${encodeURIComponent(integration.id)}/mcp?agent=${encodeURIComponent(agentId)}`,
        credentials: { bearerToken: access.credentials.mcpToken },
      };
    })
    .filter(Boolean) as {
    name: string;
    url: string;
    credentials: { bearerToken: string };
  }[];
}
