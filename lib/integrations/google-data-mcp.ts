import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { GoogleDataError } from "@/lib/integrations/google-data-client";
import { getRunGoogleDataRuntimeAccess } from "@/lib/integrations/google-data-service";

const activeCalls = new Map<string, number>();
const MAX_CONCURRENT_CALLS = 4;
const MAX_TOOL_RESULT_CHARACTERS = 100_000;

function resolveToken(request: Request) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-api-key") ||
    ""
  );
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

function safeResult(value: unknown) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  if (text.length > MAX_TOOL_RESULT_CHARACTERS) {
    throw new GoogleDataError(
      "GOOGLE_RESPONSE_TOO_LARGE",
      "Google returned too much data for one tool result. Use a narrower query or smaller row limit.",
    );
  }
  return { content: [{ type: "text" as const, text }] };
}

function toolError(error: unknown) {
  const known = error instanceof GoogleDataError;
  return new Error(
    JSON.stringify({
      error: {
        code: known ? error.code : "GOOGLE_OPERATION_FAILED",
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Google operation failed.",
        ...(known && error.status ? { status: error.status } : {}),
      },
    }),
  );
}

async function withGoogleSlot<T>(integrationId: string, call: () => Promise<T>) {
  const active = activeCalls.get(integrationId) ?? 0;
  if (active >= MAX_CONCURRENT_CALLS) {
    throw new GoogleDataError(
      "GOOGLE_CONNECTOR_BUSY",
      "This Google integration already has too many active requests. Try again shortly.",
    );
  }
  activeCalls.set(integrationId, active + 1);
  try {
    return await call();
  } finally {
    const remaining = (activeCalls.get(integrationId) ?? 1) - 1;
    if (remaining > 0) activeCalls.set(integrationId, remaining);
    else activeCalls.delete(integrationId);
  }
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_:.-]+$/);

export async function handleGoogleDataMcpRequest(
  request: Request,
  integrationId: string,
  runId: string,
) {
  const access = getRunGoogleDataRuntimeAccess(
    integrationId,
    runId,
    resolveToken(request),
  );
  if (access.status === "stale") {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32009,
          message:
            "CAPABILITY_VERSION_CHANGED: Google integration configuration changed after this run started.",
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
  if (access.status !== "ok") return unauthorizedResponse();
  const allowed = new Set(access.allowedTools);
  const call = async (operation: () => Promise<unknown>) => {
    try {
      return safeResult(await withGoogleSlot(integrationId, operation));
    } catch (error) {
      throw toolError(error);
    }
  };
  const server = new McpServer({
    name: `${access.record.provider}_${access.record.slug}`,
    version: "0.1.0",
  });

  if (
    access.record.provider === "google_analytics" &&
    allowed.has("google_analytics_list_properties")
  ) {
    server.registerTool(
      "google_analytics_list_properties",
      {
        title: "List Google Analytics properties",
        description:
          "List GA4 accounts and properties available to this connected Google account. Use the returned numeric property ID in reporting tools.",
        inputSchema: {
          pageSize: z.number().int().min(1).max(200).default(100),
          pageToken: z.string().max(4096).optional(),
        },
        annotations: readAnnotations,
      },
      async (input) =>
        call(() => access.adapter.listAnalyticsProperties(input)),
    );
  }

  if (
    access.record.provider === "google_analytics" &&
    allowed.has("google_analytics_search_metadata")
  ) {
    server.registerTool(
      "google_analytics_search_metadata",
      {
        title: "Search GA4 dimensions and metrics",
        description:
          "Search the standard and custom dimensions or metrics supported by one GA4 property. Use this before composing a report with unfamiliar field names.",
        inputSchema: {
          propertyId: z.string().trim().min(1).max(64),
          query: z.string().trim().max(160).optional(),
          kind: z.enum(["all", "dimension", "metric"]).default("all"),
          limit: z.number().int().min(1).max(100).default(30),
        },
        annotations: readAnnotations,
      },
      async (input) =>
        call(() => access.adapter.searchAnalyticsMetadata(input)),
    );
  }

  if (
    access.record.provider === "google_analytics" &&
    allowed.has("google_analytics_run_report")
  ) {
    server.registerTool(
      "google_analytics_run_report",
      {
        title: "Run Google Analytics report",
        description:
          "Run a bounded historical GA4 report. Use explicit dates and field names returned by the metadata tool. Results are read-only.",
        inputSchema: {
          propertyId: z.string().trim().min(1).max(64),
          startDate: z.string().trim().min(4).max(32),
          endDate: z.string().trim().min(4).max(32),
          dimensions: z.array(identifier).min(1).max(9),
          metrics: z.array(identifier).min(1).max(10),
          limit: z.number().int().min(1).max(500).default(100),
          offset: z.number().int().min(0).max(1_000_000).default(0),
          keepEmptyRows: z.boolean().default(false),
        },
        annotations: readAnnotations,
      },
      async (input) => call(() => access.adapter.runAnalyticsReport(input)),
    );
  }

  if (
    access.record.provider === "google_analytics" &&
    allowed.has("google_analytics_run_realtime_report")
  ) {
    server.registerTool(
      "google_analytics_run_realtime_report",
      {
        title: "Run realtime Google Analytics report",
        description:
          "Read bounded realtime GA4 activity for the current 30-minute window. Realtime supports fewer fields than historical reporting.",
        inputSchema: {
          propertyId: z.string().trim().min(1).max(64),
          dimensions: z.array(identifier).min(1).max(4),
          metrics: z.array(identifier).min(1).max(4),
          limit: z.number().int().min(1).max(250).default(100),
        },
        annotations: readAnnotations,
      },
      async (input) =>
        call(() => access.adapter.runAnalyticsRealtimeReport(input)),
    );
  }

  if (
    access.record.provider === "google_search_console" &&
    allowed.has("search_console_list_sites")
  ) {
    server.registerTool(
      "search_console_list_sites",
      {
        title: "List Search Console sites",
        description:
          "List Search Console URL-prefix and domain properties available to this connected Google account.",
        inputSchema: {},
        annotations: readAnnotations,
      },
      async () => call(() => access.adapter.listSearchConsoleSites()),
    );
  }

  if (
    access.record.provider === "google_search_console" &&
    allowed.has("search_console_query_performance")
  ) {
    server.registerTool(
      "search_console_query_performance",
      {
        title: "Query Search Console performance",
        description:
          "Query bounded search performance rows with clicks, impressions, CTR, and average position. Search Console returns representative top rows, not a guaranteed exhaustive export.",
        inputSchema: {
          siteUrl: z.string().trim().min(1).max(2048),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          dimensions: z
            .array(
              z.enum([
                "date",
                "query",
                "page",
                "country",
                "device",
                "searchAppearance",
                "hour",
              ]),
            )
            .min(1)
            .max(5),
          searchType: z
            .enum(["web", "image", "video", "news", "discover", "googleNews"])
            .default("web"),
          rowLimit: z.number().int().min(1).max(1000).default(250),
          startRow: z.number().int().min(0).max(25_000).default(0),
        },
        annotations: readAnnotations,
      },
      async (input) =>
        call(() => access.adapter.querySearchPerformance(input)),
    );
  }

  if (
    access.record.provider === "google_search_console" &&
    allowed.has("search_console_list_sitemaps")
  ) {
    server.registerTool(
      "search_console_list_sitemaps",
      {
        title: "List Search Console sitemaps",
        description:
          "List submitted sitemaps and their read-only processing metadata for one Search Console property.",
        inputSchema: { siteUrl: z.string().trim().min(1).max(2048) },
        annotations: readAnnotations,
      },
      async (input) =>
        call(() => access.adapter.listSearchConsoleSitemaps(input)),
    );
  }

  if (
    access.record.provider === "google_search_console" &&
    allowed.has("search_console_inspect_url")
  ) {
    server.registerTool(
      "search_console_inspect_url",
      {
        title: "Inspect URL in Search Console",
        description:
          "Read Google's indexed status for one URL within a Search Console property. This does not request indexing or modify the site.",
        inputSchema: {
          siteUrl: z.string().trim().min(1).max(2048),
          inspectionUrl: z.string().url().max(2048),
          languageCode: z.string().trim().min(2).max(20).optional(),
        },
        annotations: readAnnotations,
      },
      async (input) =>
        call(() => access.adapter.inspectSearchConsoleUrl(input)),
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
