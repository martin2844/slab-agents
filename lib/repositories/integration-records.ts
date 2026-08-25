import type {
  CalendarWritePolicy,
  Integration,
  IntegrationAuthType,
  IntegrationHttpOperation,
  IntegrationMcpTool,
  IntegrationProvider,
  IntegrationStatus,
  IntegrationTool,
} from "@/lib/types";
import { POSTHOG_TOOLS } from "@/lib/integrations/catalog";
import {
  normalizeIntegrationSlug,
  normalizeIntegrationToolKey,
} from "@/lib/integrations/naming";
import { bool, json, type Row } from "@/lib/repositories/repository-helpers";

export type IntegrationRecord = {
  id: string;
  provider: IntegrationProvider;
  name: string;
  slug: string;
  config: {
    datacenter?: "us" | "eu";
    baseUrl?: string;
    authType?: IntegrationAuthType;
    authHeaderName?: string | null;
    timeoutMs?: number;
    accountEmail?: string | null;
    accountName?: string | null;
    writePolicy?: CalendarWritePolicy;
    oauthConfigured?: boolean;
    calendarId?: string | null;
    username?: string | null;
    apiVersion?: string | null;
    eventTypeId?: number | null;
    providerMetadata?: Record<string, unknown>;
  };
  authType: IntegrationAuthType;
  authHeaderName?: string | null;
  enabled: boolean;
  version: number;
  credentialsCiphertext: string;
  status: IntegrationStatus;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunIntegrationCapabilityRecord = {
  runId: string;
  integrationId: string;
  agentId: string;
  integrationVersion: number;
  tokenHash: string;
  allowedTools: string[];
  createdAt: string;
  updatedAt: string;
};

export function mapIntegrationRecord(row: Row): IntegrationRecord {
  const config = json(row.config_json, {
    datacenter: "us",
  }) as IntegrationRecord["config"];
  return {
    id: String(row.id),
    provider: row.provider as IntegrationProvider,
    name: String(row.name),
    slug: row.slug
      ? String(row.slug)
      : `integration-${String(row.id).slice(0, 8)}`,
    config,
    authType: config.authType ?? ("none" as IntegrationAuthType),
    authHeaderName: config.authHeaderName ?? null,
    enabled: bool(row.enabled),
    version: Number(row.version ?? 1),
    credentialsCiphertext: String(row.credentials_ciphertext),
    status: row.status as IntegrationStatus,
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapRunIntegrationCapability(
  row: Row,
): RunIntegrationCapabilityRecord {
  return {
    runId: String(row.run_id),
    integrationId: String(row.integration_id),
    agentId: String(row.agent_id),
    integrationVersion: Number(row.integration_version),
    tokenHash: String(row.token_hash),
    allowedTools: json(row.allowed_tools_json, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapIntegration(
  record: IntegrationRecord,
  permissions: Record<string, string[]>,
  operations: IntegrationHttpOperation[] = [],
  mcpTools: IntegrationMcpTool[] = [],
): Integration {
  const normalizedSlug = normalizeIntegrationSlug(record.slug);
  const calendarTools: IntegrationTool[] = [
    {
      key: "calendar_list_calendars",
      name: "List calendars",
      description: "List calendars available through this connected account.",
      readOnly: true,
    },
    {
      key: "calendar_list_events",
      name: "List events",
      description:
        "List bounded calendar events within an explicit time range.",
      readOnly: true,
    },
    {
      key: "calendar_get_event",
      name: "Get event",
      description: "Read one calendar event by its provider identifier.",
      readOnly: true,
    },
    {
      key: "calendar_find_availability",
      name: "Find availability",
      description: "Inspect busy periods within an explicit time range.",
      readOnly: true,
    },
    {
      key: "calendar_create_event",
      name: "Create event",
      description: "Create a calendar event or booking.",
      readOnly: false,
    },
    {
      key: "calendar_update_event",
      name: "Update event",
      description: "Update or reschedule an existing calendar event.",
      readOnly: false,
    },
    {
      key: "calendar_cancel_event",
      name: "Cancel event",
      description: "Cancel or delete an existing calendar event.",
      readOnly: false,
    },
  ];
  const isCalendar = record.provider.startsWith("calendar_");
  const tools: IntegrationTool[] =
    record.provider === "posthog"
      ? POSTHOG_TOOLS
      : record.provider === "custom_http"
        ? operations
            .filter((operation) => operation.enabled)
            .map((operation) => ({
              key: `${normalizedSlug}__${operation.key}`,
              name: operation.name,
              description: operation.description,
              readOnly: true,
            }))
        : record.provider === "custom_mcp"
          ? mcpTools.map((tool) => ({
              key: `${normalizedSlug}__${normalizeIntegrationToolKey(tool.name)}`,
              name: tool.name,
              description: tool.description ?? "Custom MCP tool",
              readOnly: tool.readOnlyHint,
            }))
          : isCalendar
            ? calendarTools.filter(
                (tool) => record.provider !== "calendar_ics" || tool.readOnly,
              )
            : [];

  return {
    id: record.id,
    provider: record.provider,
    name: record.name,
    slug: record.slug,
    datacenter: record.config.datacenter,
    baseUrl: record.config.baseUrl,
    accountEmail: record.config.accountEmail ?? null,
    accountName: record.config.accountName ?? null,
    writePolicy: record.config.writePolicy ?? "approval_required",
    oauthConfigured: record.config.oauthConfigured ?? false,
    calendarId: record.config.calendarId ?? null,
    calendarUsername: record.config.username ?? null,
    calendarTenant:
      typeof record.config.providerMetadata?.tenant === "string"
        ? record.config.providerMetadata.tenant
        : null,
    calendarEventTypeId: record.config.eventTypeId ?? null,
    timeoutMs: record.config.timeoutMs ?? null,
    kind: record.config.authType === "none" ? "read" : "readwrite",
    authType: record.authType,
    authHeaderName: record.authHeaderName,
    enabled: record.enabled,
    version: record.version,
    hasSecret:
      isCalendar ||
      (record.provider !== "posthog" && record.authType !== "none"),
    hasApiKey:
      record.provider === "posthog" && Boolean(record.credentialsCiphertext),
    status: record.status,
    operations: record.provider === "custom_http" ? operations : undefined,
    mcpTools: record.provider === "custom_mcp" ? mcpTools : undefined,
    lastTestedAt: record.lastTestedAt,
    lastError: record.lastError,
    permissions,
    tools,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapCustomHttpOperation(row: Row): IntegrationHttpOperation {
  return {
    id: String(row.id),
    integrationId: String(row.integration_id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description ?? ""),
    method: row.method === "HEAD" ? "HEAD" : "GET",
    path: String(row.path),
    parameters: json(row.parameters_json, []),
    responsePath: row.response_path ? String(row.response_path) : undefined,
    maxResponseBytes: row.max_response_bytes
      ? Number(row.max_response_bytes)
      : null,
    maxItems: row.max_items ? Number(row.max_items) : null,
    timeoutMs: row.timeout_ms ? Number(row.timeout_ms) : null,
    enabled: bool(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapCustomMcpTool(row: Row): IntegrationMcpTool {
  return {
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    inputSchema: json(
      row.input_schema_json,
      {},
    ) as IntegrationMcpTool["inputSchema"],
    readOnlyHint: bool(row.read_only_hint),
    destructiveHint: bool(row.destructive_hint),
    idempotentHint:
      row.idempotent_hint != null ? bool(row.idempotent_hint) : null,
    openWorldHint:
      row.open_world_hint != null ? bool(row.open_world_hint) : null,
  };
}
