import "server-only";

import { integrationRepository } from "@/lib/repositories/integration-repository";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { callMcpTool } from "@/lib/mcp/client";
import {
  listPostHogProjects,
  queryPostHogAnalytics,
} from "@/lib/integrations/posthog";
import {
  getRunCustomIntegrationRuntimeAccess,
  getPostHogRuntimeAccess,
} from "@/lib/integrations/service";
import type { IntegrationHttpOperation } from "@/lib/types";
import { compileMcpInputSchema } from "@/lib/integrations/json-schema";
import {
  normalizeIntegrationSlug,
  normalizeIntegrationToolKey,
} from "@/lib/integrations/naming";
import {
  redactIntegrationText,
  sanitizeIntegrationValue,
} from "@/lib/integrations/redaction";

const connectorCalls = new Map<string, number>();
const MAX_CONCURRENT_CONNECTOR_CALLS = 4;

function sanitizeJsonResult(value: unknown, secrets: string[] = []) {
  const safeValue = sanitizeIntegrationValue(value, secrets);
  const serialized = JSON.stringify(safeValue, null, 2) ?? "null";
  if (serialized.length <= 100_000) {
    return serialized;
  }
  return `${serialized.slice(0, 100_000)}\n\n[Output truncated. Use a narrower query.]`;
}

function toolResult(value: unknown, secrets: string[] = []) {
  return {
    content: [
      { type: "text" as const, text: sanitizeJsonResult(value, secrets) },
    ],
  };
}

function unauthorizedResponse() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    },
    { status: 401 },
  );
}

function resolveToken(request: Request) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-api-key") ||
    ""
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getSchemaType(
  type: IntegrationHttpOperation["parameters"][number]["type"],
) {
  switch (type) {
    case "number":
      return z.number().finite();
    case "integer":
      return z.number().int().finite();
    case "boolean":
      return z.boolean();
    case "string":
    default:
      return z.string();
  }
}

function applyResponsePath(value: unknown, responsePath?: string): unknown {
  if (!responsePath) return value;
  const parts = responsePath
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = value;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    if (!(part in record)) return undefined;
    current = record[part];
  }

  return current;
}

function limitItems(value: unknown, maxItems?: number | null) {
  if (!maxItems || maxItems <= 0) return value;
  if (!Array.isArray(value)) return value;
  return value.slice(0, maxItems);
}

function connectorError(code: string, message: string, status?: number) {
  return new Error(
    JSON.stringify({
      error: { code, message, ...(status ? { status } : {}) },
    }),
  );
}

async function withConnectorSlot<T>(
  integrationId: string,
  task: () => Promise<T>,
) {
  const active = connectorCalls.get(integrationId) ?? 0;
  if (active >= MAX_CONCURRENT_CONNECTOR_CALLS) {
    throw connectorError(
      "CONNECTOR_BUSY",
      "The integration has reached its concurrent request limit.",
    );
  }
  connectorCalls.set(integrationId, active + 1);
  try {
    return await task();
  } finally {
    const remaining = (connectorCalls.get(integrationId) ?? 1) - 1;
    if (remaining > 0) connectorCalls.set(integrationId, remaining);
    else connectorCalls.delete(integrationId);
  }
}

async function readLimitedBody(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw connectorError(
      "CONNECTOR_RESPONSE_TOO_LARGE",
      `Response exceeded limit (${maxBytes} bytes).`,
      response.status,
    );
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw connectorError(
        "CONNECTOR_RESPONSE_TOO_LARGE",
        `Response exceeded limit (${maxBytes} bytes).`,
        response.status,
      );
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

async function executeCustomHttpOperation(
  operation: IntegrationHttpOperation,
  args: Record<string, unknown>,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  secrets: string[],
) {
  const resolvedPath = operation.path.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = args[key];
    if (typeof value === "undefined") {
      throw new Error(`Missing required path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });

  const url = new URL(`${baseUrl}${resolvedPath}`);

  for (const parameter of operation.parameters) {
    if (parameter.location !== "query") continue;
    const value = args[parameter.name];
    if (typeof value === "undefined") {
      if (parameter.required) {
        throw new Error(`Missing required query parameter: ${parameter.name}`);
      }
      continue;
    }
    if (value === null) continue;
    url.searchParams.set(parameter.name, String(value));
  }

  const timeout = AbortSignal.timeout(Math.max(1_000, timeoutMs));
  let response: Response;
  try {
    response = await fetch(url, {
      method: operation.method,
      redirect: "manual",
      headers,
      signal: timeout,
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw connectorError(
        "CONNECTOR_TIMEOUT",
        "The connector request timed out.",
      );
    }
    throw connectorError(
      "CONNECTOR_HTTP_ERROR",
      "The connector request failed.",
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw connectorError(
      "CONNECTOR_HTTP_ERROR",
      "Redirect received and blocked for safety.",
      response.status,
    );
  }

  const maxResponseBytes = operation.maxResponseBytes ?? 32 * 1024;
  const bytes = await readLimitedBody(response, maxResponseBytes);

  if (!response.ok) {
    const body = redactIntegrationText(
      new TextDecoder().decode(bytes).slice(0, 4096),
      secrets,
    );
    throw connectorError(
      response.status === 401 || response.status === 403
        ? "CONNECTOR_AUTH_FAILED"
        : "CONNECTOR_HTTP_ERROR",
      `HTTP ${response.status}: ${body || "request failed"}`,
      response.status,
    );
  }

  if (operation.method === "HEAD") {
    return { status: response.status };
  }

  const rawBody = new TextDecoder().decode(bytes);
  const mime = response.headers.get("content-type") || "";
  let parsed: unknown;
  try {
    parsed = mime.toLowerCase().includes("application/json")
      ? rawBody
        ? JSON.parse(rawBody)
        : null
      : rawBody || "";
  } catch {
    throw connectorError(
      "CONNECTOR_INVALID_RESPONSE",
      "The connector returned invalid JSON.",
      response.status,
    );
  }

  const safeParsed = sanitizeIntegrationValue(parsed, secrets);
  const shaped = applyResponsePath(safeParsed, operation.responsePath);
  if (operation.responsePath && shaped === undefined) {
    throw connectorError(
      "CONNECTOR_INVALID_RESPONSE",
      `Response path '${operation.responsePath}' was not found.`,
      response.status,
    );
  }
  const trimmed = limitItems(shaped, operation.maxItems);
  return {
    data: trimmed,
    status: response.status,
  };
}

function buildCustomHttpSchema(operation: IntegrationHttpOperation) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const parameter of operation.parameters) {
    let schema = getSchemaType(parameter.type);
    if (parameter.location === "path" && parameter.type === "string") {
      schema = z.string().trim().min(1);
    }
    if (parameter.description) {
      schema = schema.describe(parameter.description);
    }
    if (parameter.required) {
      shape[parameter.name] = schema;
    } else {
      shape[parameter.name] = schema.optional();
    }
  }

  return shape;
}

export async function handlePostHogMcpRequest(
  request: Request,
  integrationId: string,
  agentId: string,
) {
  const access = getPostHogRuntimeAccess(integrationId, agentId);
  const token = resolveToken(request);
  if (!access || !token || token !== access.credentials.mcpToken) {
    return unauthorizedResponse();
  }

  const server = new McpServer({ name: "posthog", version: "0.1.0" });
  const allowed = new Set(access.allowedTools);

  if (allowed.has("list_projects")) {
    server.registerTool(
      "list_projects",
      {
        title: "List PostHog projects",
        description:
          "List the PostHog projects this personal API key can access. Use this before analytics queries when the project ID is unknown.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async () =>
        toolResult(
          await listPostHogProjects(
            access.record.config.datacenter ?? "us",
            access.credentials.apiKey,
          ),
        ),
    );
  }

  if (allowed.has("query_analytics")) {
    server.registerTool(
      "query_analytics",
      {
        title: "Query PostHog analytics",
        description:
          "Run a read-only HogQL query in one PostHog project. Use bounded SELECT queries, explicit date ranges, and small limits.",
        inputSchema: {
          projectId: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .describe("Numeric PostHog project ID"),
          query: z
            .string()
            .trim()
            .min(1)
            .max(12_000)
            .refine(
              (value) => /^(select|with|show|describe|explain)\b/i.test(value),
              "Only read-only HogQL queries are allowed",
            )
            .describe("A bounded, read-only HogQL query"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async ({ projectId, query }) =>
        toolResult(
          await queryPostHogAnalytics(
            access.record.config.datacenter ?? "us",
            access.credentials.apiKey,
            projectId,
            query,
          ),
        ),
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function handleCustomHttpMcpRequest(
  request: Request,
  integrationId: string,
  runId: string,
) {
  const token = resolveToken(request);
  const access = getRunCustomIntegrationRuntimeAccess(
    integrationId,
    runId,
    token,
  );
  if (access.status === "stale") {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32009,
          message:
            "CAPABILITY_VERSION_CHANGED: integration configuration changed after this run started.",
          data: {
            expectedVersion: access.integrationVersion,
            currentVersion: access.currentVersion,
          },
        },
        id: null,
      },
      { status: 409 },
    );
  }
  if (access.status !== "ok") {
    return unauthorizedResponse();
  }
  const record = access.record;

  const operations = integrationRepository.listCustomHttpOperations(record.id);
  if (!operations || operations.length === 0) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "No custom HTTP operations configured.",
        },
        id: null,
      },
      { status: 404 },
    );
  }

  const allowed = new Set(access.allowedTools);
  const headers = (() => {
    const authType = record.config.authType ?? "none";
    if (authType === "none") return {} as Record<string, string>;
    if (authType === "bearer") {
      return { Authorization: `Bearer ${access.credentials.authSecret ?? ""}` };
    }
    return {
      [record.config.authHeaderName ?? "X-API-Key"]:
        access.credentials.authSecret ?? "",
    };
  })();

  const server = new McpServer({
    name: `custom_http_${record.slug}`,
    version: "0.1.0",
  });

  for (const operation of operations) {
    if (!operation.enabled) continue;
    const fullName = `${record.slug}__${operation.key}`;
    if (!allowed.has(fullName) && !allowed.has(operation.key)) continue;

    server.registerTool(
      fullName,
      {
        title: operation.name,
        description:
          operation.description ||
          `Read data from ${record.name} operation ${operation.name}`,
        inputSchema: buildCustomHttpSchema(operation),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const safeArgs = (args as Record<string, unknown>) ?? {};
        const result = await withConnectorSlot(record.id, () =>
          executeCustomHttpOperation(
            operation,
            safeArgs,
            String(record.config.baseUrl),
            headers,
            operation.timeoutMs ??
              record.config.timeoutMs ??
              DEFAULT_HTTP_TIMEOUT_MS,
            access.credentials.authSecret
              ? [access.credentials.authSecret]
              : [],
          ),
        );
        return toolResult(
          result,
          access.credentials.authSecret ? [access.credentials.authSecret] : [],
        );
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function handleCustomMcpRequest(
  request: Request,
  integrationId: string,
  runId: string,
) {
  const token = resolveToken(request);
  const access = getRunCustomIntegrationRuntimeAccess(
    integrationId,
    runId,
    token,
  );
  if (access.status === "stale") {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32009,
          message:
            "CAPABILITY_VERSION_CHANGED: integration configuration changed after this run started.",
          data: {
            expectedVersion: access.integrationVersion,
            currentVersion: access.currentVersion,
          },
        },
        id: null,
      },
      { status: 409 },
    );
  }
  if (access.status !== "ok") {
    return unauthorizedResponse();
  }
  const record = access.record;

  const tools = integrationRepository.listCustomMcpTools(record.id);
  if (!tools.length) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "No MCP tools configured for this integration.",
        },
        id: null,
      },
      { status: 404 },
    );
  }

  const allowed = new Set(access.allowedTools);
  const headers = (() => {
    const authType = record.config.authType ?? "none";
    if (authType === "none") return {} as Record<string, string>;
    if (authType === "bearer") {
      return { Authorization: `Bearer ${access.credentials.authSecret ?? ""}` };
    }
    return {
      [record.config.authHeaderName ?? "X-API-Key"]:
        access.credentials.authSecret ?? "",
    };
  })();

  const remoteConnection = {
    url: String(record.config.baseUrl),
    headers,
  };

  const server = new McpServer({
    name: `custom_mcp_${record.slug}`,
    version: "0.1.0",
  });

  for (const tool of tools) {
    const fullName = `${normalizeIntegrationSlug(record.slug)}__${normalizeIntegrationToolKey(tool.name)}`;
    if (!allowed.has(fullName) && !allowed.has(tool.name)) continue;

    server.registerTool(
      fullName,
      {
        title: tool.name,
        description: readString(tool.description) || `Proxy for ${tool.name}`,
        inputSchema: compileMcpInputSchema(tool.inputSchema),
        annotations: {
          readOnlyHint: tool.readOnlyHint,
          destructiveHint: tool.destructiveHint,
          ...(tool.idempotentHint == null
            ? {}
            : { idempotentHint: tool.idempotentHint }),
          ...(tool.openWorldHint == null
            ? {}
            : { openWorldHint: tool.openWorldHint }),
        },
      },
      async (arguments_: unknown) => {
        const toolArguments =
          arguments_ && typeof arguments_ === "object"
            ? (arguments_ as Record<string, unknown>)
            : {};
        const secrets = access.credentials.authSecret
          ? [access.credentials.authSecret]
          : [];
        try {
          const delegated = await withConnectorSlot(record.id, () =>
            callMcpTool(remoteConnection, tool.name, toolArguments),
          );
          return toolResult(delegated, secrets);
        } catch (error) {
          const message = redactIntegrationText(
            error instanceof Error ? error.message : "Remote MCP tool failed.",
            secrets,
          );
          throw new Error(message);
        }
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function routeCustomMcpRequest(
  request: Request,
  integrationId: string,
  runId: string,
) {
  const integration = integrationRepository.getIntegrationRecord(integrationId);
  if (!integration) return unauthorizedResponse();

  if (integration.provider === "custom_http") {
    return handleCustomHttpMcpRequest(request, integrationId, runId);
  }
  return handleCustomMcpRequest(request, integrationId, runId);
}
