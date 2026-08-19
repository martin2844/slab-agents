import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { callMcpTool } from "@/lib/mcp/client";
import { repository } from "@/lib/repository";
import {
  listPostHogProjects,
  queryPostHogAnalytics,
} from "@/lib/integrations/posthog";
import {
  getCustomIntegrationRuntimeAccess,
  getPostHogRuntimeAccess,
} from "@/lib/integrations/service";
import type { IntegrationHttpOperation } from "@/lib/types";

function sanitizeJsonResult(value: unknown) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= 100_000) {
    return serialized;
  }
  return `${serialized.slice(0, 100_000)}\n\n[Output truncated. Use a narrower query.]`;
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: sanitizeJsonResult(value) }] };
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

function getSchemaType(type: IntegrationHttpOperation["parameters"][number]["type"]) {
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

function applyResponsePath(
  value: unknown,
  responsePath?: string,
): unknown {
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

function buildInputSchemaFromJsonSchema(raw: unknown) {
  if (raw && typeof raw === "object" && "type" in raw) {
    const schema = raw as Record<string, unknown>;
    if (schema.type === "object") {
      const properties = (schema.properties as Record<string, unknown>) ?? {};
      const required = new Set(
        Array.isArray(schema.required) ? schema.required.map(String) : [],
      );
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, property] of Object.entries(properties)) {
        const typed = property as Record<string, unknown>;
        let valueSchema: z.ZodTypeAny = z.unknown();
        if (typed.type === "string") {
          valueSchema = z.string();
        } else if (typed.type === "number" || typed.type === "integer") {
          valueSchema = z.number();
        } else if (typed.type === "boolean") {
          valueSchema = z.boolean();
        } else if (typed.type === "array") {
          valueSchema = z.array(z.unknown());
        } else if (typed.type === "object") {
          valueSchema = z.record(z.string(), z.unknown());
        }
        if (typeof typed.description === "string") {
          valueSchema = valueSchema.describe(typed.description);
        }
        if (required.has(key)) {
          shape[key] = valueSchema;
        } else {
          shape[key] = valueSchema.optional();
        }
      }
      return z.object(shape).passthrough().optional();
    }
  }
  return z.record(z.string(), z.unknown());
}

function sanitizeMcpError(message: string, status?: number) {
  return {
    error: {
      code: "CONNECTOR_HTTP_ERROR",
      message: message || "Request failed.",
      ...(status ? { status } : {}),
    },
  };
}

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

async function executeCustomHttpOperation(
  operation: IntegrationHttpOperation,
  args: Record<string, unknown>,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
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
  const response = await fetch(url, {
    method: operation.method,
    redirect: "manual",
    headers,
    signal: timeout,
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      JSON.stringify(
        sanitizeMcpError(
          "Redirect received and blocked for safety.",
          response.status,
        ),
      ),
    );
  }

  const bytes = await response.arrayBuffer();
  const maxResponseBytes = operation.maxResponseBytes ?? 0;
  if (maxResponseBytes > 0 && bytes.byteLength > maxResponseBytes) {
    throw new Error(
      JSON.stringify({
        error: {
          code: "CONNECTOR_RESPONSE_TOO_LARGE",
          message: `Response exceeded limit (${maxResponseBytes} bytes).`,
          status: response.status,
        },
      }),
    );
  }

  if (!response.ok) {
    const body = new TextDecoder().decode(bytes).slice(0, 4096);
    throw new Error(
      JSON.stringify(
        sanitizeMcpError(
          `HTTP ${response.status}: ${body || "request failed"}`,
          response.status,
        ),
      ),
    );
  }

  if (operation.method === "HEAD") {
    return { status: response.status };
  }

  const rawBody = new TextDecoder().decode(bytes);
  const mime = response.headers.get("content-type") || "";
  const parsed =
    mime.toLowerCase().includes("application/json")
      ? rawBody
        ? JSON.parse(rawBody)
        : null
      : rawBody || "";

  const shaped = applyResponsePath(parsed, operation.responsePath);
  const trimmed = limitItems(shaped, operation.maxItems);
  return {
    data: trimmed,
    status: response.status,
  };
}

function buildCustomHttpSchema(operation: IntegrationHttpOperation) {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required: string[] = [];
  const requiredCheck: Array<{ name: string; location: "path" | "query" }> = [];

  for (const parameter of operation.parameters) {
    let schema = getSchemaType(parameter.type);
    if (parameter.description) {
      schema = schema.describe(parameter.description);
    }
    if (parameter.required) {
      shape[parameter.name] = schema;
      requiredCheck.push({ name: parameter.name, location: parameter.location });
      required.push(parameter.name);
    } else {
      shape[parameter.name] = schema.optional();
    }
  }

  return z
    .object(shape)
    .strict()
    .refine(
      (args) =>
        requiredCheck.every((parameter) => {
          if (parameter.location !== "path") return true;
          const value = args[parameter.name];
          return typeof value === "string" && value.trim().length > 0;
        }),
      {
        path: required,
        message: "Path parameters must be non-empty strings.",
      },
    )
    .transform((input) => ({ ...input }));
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
  agentId: string,
) {
  const access = getCustomIntegrationRuntimeAccess(integrationId, agentId);
  const record = access?.record;
  const token = resolveToken(request);
  if (!record || !access || !token || token !== access.credentials.mcpToken) {
    return unauthorizedResponse();
  }

  const operations = repository.listCustomHttpOperations(record.id);
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
        const result = await executeCustomHttpOperation(
          operation,
          safeArgs,
          String(record.config.baseUrl),
          headers,
          operation.timeoutMs ?? record.config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
        );
        return toolResult(result);
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
  agentId: string,
) {
  const access = getCustomIntegrationRuntimeAccess(integrationId, agentId);
  const record = access?.record;
  const token = resolveToken(request);
  if (!record || !access || !token || token !== access.credentials.mcpToken) {
    return unauthorizedResponse();
  }

  const tools = repository.listCustomMcpTools(record.id);
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
    const fullName = `${record.slug}__${tool.name}`;
    if (!allowed.has(fullName) && !allowed.has(tool.name)) continue;

    server.registerTool(
      fullName,
      {
        title: tool.name,
        description: readString(tool.description) || `Proxy for ${tool.name}`,
        inputSchema: buildInputSchemaFromJsonSchema(tool.inputSchema),
        annotations: {
          readOnlyHint: tool.readOnlyHint,
          destructiveHint: tool.destructiveHint,
        },
      },
      async (arguments_: Record<string, unknown>) => {
        const delegated = await callMcpTool(
          remoteConnection,
          tool.name,
          arguments_ || {},
        );
        return toolResult(delegated);
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
  agentId: string,
) {
  const access = getCustomIntegrationRuntimeAccess(integrationId, agentId);
  const record = access?.record;
  if (!record) return unauthorizedResponse();

  if (record.provider === "custom_http") {
    return handleCustomHttpMcpRequest(request, integrationId, agentId);
  }
  return handleCustomMcpRequest(request, integrationId, agentId);
}
