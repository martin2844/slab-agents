import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpConnection = { url: string; apiKey: string };

function parseTextResult(rawResult: Awaited<ReturnType<Client["callTool"]>>) {
  const result = rawResult as {
    isError?: boolean;
    structuredContent?: unknown;
    content: Array<{ type: string; text?: string }>;
  };
  if (result.isError) {
    const text = result.content.find((item) => item.type === "text");
    throw new Error(text?.text ?? "The MCP tool returned an error.");
  }
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.find((item) => item.type === "text");
  if (!text?.text) return null;
  try {
    return JSON.parse(text.text);
  } catch {
    return text.text;
  }
}

export async function callMcpTool<T>(
  connection: McpConnection,
  name: string,
  args: Record<string, unknown> = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const client = new Client({ name: "slab-agent-workspace", version: "0.1.0" });
  const headers: Record<string, string> = {};
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
    headers["X-API-Key"] = connection.apiKey;
  }
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers, signal: controller.signal },
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
      headers: connection.apiKey
        ? {
            Authorization: `Bearer ${connection.apiKey}`,
            "X-API-Key": connection.apiKey,
          }
        : {},
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
