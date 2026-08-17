import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  listPostHogProjects,
  queryPostHogAnalytics,
} from "@/lib/integrations/posthog";
import { getPostHogRuntimeAccess } from "@/lib/integrations/service";

function toolResult(value: unknown) {
  const serialized = JSON.stringify(value, null, 2);
  const text =
    serialized.length > 100_000
      ? `${serialized.slice(0, 100_000)}\n\n[Output truncated. Run a narrower query.]`
      : serialized;
  return { content: [{ type: "text" as const, text }] };
}

export async function handlePostHogMcpRequest(
  request: Request,
  integrationId: string,
  agentId: string,
) {
  const access = getPostHogRuntimeAccess(integrationId, agentId);
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!access || !token || token !== access.credentials.mcpToken) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      },
      { status: 401 },
    );
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
            access.record.config.datacenter,
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
            access.record.config.datacenter,
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
