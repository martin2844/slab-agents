import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  measureJson,
  type McpServerDefinitionMetric,
} from "@/lib/run-context-profile";

export type McpConnection = {
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

export type McpInspectionConnection = {
  url: string;
  headers: Record<string, string>;
};

export class McpToolError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.details = details;
  }
}

function parseTextResult(rawResult: Awaited<ReturnType<Client["callTool"]>>) {
  const result = rawResult as {
    isError?: boolean;
    structuredContent?: unknown;
    content: Array<{ type: string; text?: string }>;
  };

  if (result.isError) {
    const text = result.content.find((item) => item.type === "text");
    const message = text?.text ?? "The MCP tool returned an error.";
    try {
      const parsed = JSON.parse(message) as {
        error?: Record<string, unknown>;
      };
      if (parsed.error && typeof parsed.error === "object") {
        throw new McpToolError(
          String(parsed.error.code ?? "MCP_TOOL_ERROR"),
          String(parsed.error.message ?? "The MCP tool returned an error."),
          parsed.error,
        );
      }
    } catch (error) {
      if (error instanceof McpToolError) throw error;
    }
    throw new Error(message);
  }

  if (result.structuredContent !== undefined) return result.structuredContent;

  const text = result.content.find((item) => item.type === "text");
  if (!text?.text) return null;
  try {
    return JSON.parse(text.text);
  } catch {
    return text.text;
  }
}

function resolveRequestHeaders(connection: McpConnection) {
  const headers: Record<string, string> = {
    ...(connection.headers ?? {}),
  };
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
    headers["X-API-Key"] = connection.apiKey;
  }
  return headers;
}

export async function callMcpTool<T>(
  connection: McpConnection,
  name: string,
  args: Record<string, unknown> = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const client = new Client({ name: "slab-agent-workspace", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: {
      headers: resolveRequestHeaders(connection),
      signal: controller.signal,
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    return parseTextResult(result) as T;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}

export async function testMcp(connection: McpConnection) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const client = new Client({ name: "slab-agent-workspace", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: {
      headers: resolveRequestHeaders(connection),
      signal: controller.signal,
    },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    return { ok: true, tools: tools.tools.map((tool) => tool.name) };
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}

export async function inspectMcpDefinitions(
  server: string,
  connection: McpInspectionConnection,
): Promise<McpServerDefinitionMetric> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const client = new Client({
    name: "slab-agent-workspace-profiler",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: {
      headers: connection.headers,
      signal: controller.signal,
    },
  });

  try {
    await client.connect(transport);
    const response = await client.listTools();
    const total = measureJson(response.tools);

    return {
      server,
      ...total,
      toolCount: response.tools.length,
      tools: response.tools
        .map((tool) => ({
          name: tool.name,
          ...measureJson(tool),
        }))
        .sort((a, b) => b.approxTokens - a.approxTokens),
      success: true,
    };
  } catch {
    return {
      server,
      bytes: 0,
      approxTokens: 0,
      toolCount: 0,
      tools: [],
      success: false,
      error: "MCP tools/list probe failed.",
    };
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}
