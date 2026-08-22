import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";
import type {
  Agent,
  AgentQuickAction,
  AgentEmailAccess,
  Approval,
  Automation,
  IntegrationHttpOperation,
  IntegrationMcpTool,
  Integration,
  IntegrationProvider,
  IntegrationStatus,
  IntegrationAuthType,
  IntegrationTool,
  CalendarWritePolicy,
  EmailSendPolicy,
  Message,
  Run,
  RunEvent,
  RunStatus,
  Thread,
} from "@/lib/types";
import { POSTHOG_TOOLS } from "@/lib/integrations/catalog";

type Row = Record<string, unknown>;
const bool = (value: unknown) => Boolean(value);
const json = <T>(value: unknown, fallback: T): T => {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback;
  } catch {
    return fallback;
  }
};

function mapAgent(row: Row): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    role: String(row.role),
    instructions: String(row.instructions),
    runtime: "codex",
    model: String(row.model),
    enabled: bool(row.enabled),
    fullAccess: bool(row.full_access),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapAgentQuickAction(row: Row): AgentQuickAction {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    label: String(row.label),
    prompt: String(row.prompt),
    position: Number(row.position),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapThread(row: Row): Thread {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    title: String(row.title),
    runtimeThreadId: row.runtime_thread_id
      ? String(row.runtime_thread_id)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapMessage(row: Row): Message {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    runId: row.run_id ? String(row.run_id) : null,
    role: row.role as Message["role"],
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}
function mapRun(row: Row): Run {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    automationId: row.automation_id ? String(row.automation_id) : null,
    trigger: row.trigger as Run["trigger"],
    mode: row.mode as Run["mode"],
    issueKey: row.issue_key ? String(row.issue_key) : null,
    runInstructions: String(row.run_instructions ?? ""),
    status: row.status as RunStatus,
    runtime: String(row.runtime),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    error: row.error ? String(row.error) : null,
    usage: json(row.usage_json, null),
  };
}
function mapAutomation(row: Row): Automation {
  return {
    id: String(row.id),
    name: String(row.name),
    agentId: String(row.agent_id),
    agentName: row.agent_name ? String(row.agent_name) : undefined,
    cronExpression: row.cron_expression ? String(row.cron_expression) : null,
    prompt: String(row.prompt),
    mode: row.mode as Automation["mode"],
    enabled: bool(row.enabled),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    lastRunId: row.last_run_id ? String(row.last_run_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapApproval(row: Row): Approval {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    runnerApprovalId: String(row.runner_approval_id),
    command: String(row.command),
    details: json(row.details_json, {}),
    status: row.status as Approval["status"],
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

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

function mapIntegrationRecord(row: Row): IntegrationRecord {
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

function mapRunIntegrationCapability(row: Row): RunIntegrationCapabilityRecord {
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

function mapIntegration(
  record: IntegrationRecord,
  permissions: Record<string, string[]>,
  operations: IntegrationHttpOperation[] = [],
  mcpTools: IntegrationMcpTool[] = [],
): Integration {
  const normalizedSlug = normalizeSlug(record.slug);
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
              key: `${normalizedSlug}__${normalizeToolKey(tool.name)}`,
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

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function normalizeToolKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function mapCustomHttpOperation(row: Row): IntegrationHttpOperation {
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

function mapCustomMcpTool(row: Row): IntegrationMcpTool {
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

function mapAgentEmailAccess(row: Row, accountIds: string[]): AgentEmailAccess {
  return {
    agentId: String(row.agent_id),
    profileId: String(row.profile_id),
    profileName: String(row.profile_name),
    accountIds,
    readEnabled: bool(row.read_enabled),
    draftEnabled: bool(row.draft_enabled),
    sendEnabled: bool(row.send_enabled),
    sendPolicy: row.send_policy as EmailSendPolicy,
    tokenId: String(row.token_id),
    tokenPrefix: String(row.token_prefix),
    tokenCreatedAt: String(row.token_created_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const repository = {
  getSetting(key: string) {
    return (
      (
        db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
          { value: string } | undefined
      )?.value ?? null
    );
  },

  createIntegrationOAuthState(input: {
    id: string;
    integrationId: string;
    provider: "calendar_google" | "calendar_microsoft";
    verifierCiphertext: string;
    redirectUri: string;
    expiresAt: string;
    integrationVersion: number;
  }) {
    db.prepare(
      `INSERT INTO integration_oauth_states
        (id,integration_id,provider,verifier_ciphertext,redirect_uri,expires_at,integration_version,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      input.id,
      input.integrationId,
      input.provider,
      input.verifierCiphertext,
      input.redirectUri,
      input.expiresAt,
      input.integrationVersion,
      now(),
    );
  },
  consumeIntegrationOAuthState(id: string) {
    const transaction = db.transaction(() => {
      const row = db
        .prepare("SELECT * FROM integration_oauth_states WHERE id=?")
        .get(id) as Row | undefined;
      db.prepare("DELETE FROM integration_oauth_states WHERE id=?").run(id);
      return row;
    });
    const row = transaction();
    if (!row || Date.parse(String(row.expires_at)) <= Date.now()) return null;
    return {
      id: String(row.id),
      integrationId: String(row.integration_id),
      provider: row.provider as "calendar_google" | "calendar_microsoft",
      verifierCiphertext: String(row.verifier_ciphertext),
      redirectUri: String(row.redirect_uri),
      expiresAt: String(row.expires_at),
      integrationVersion: Number(row.integration_version ?? 1),
    };
  },
  setSetting(key: string, value: string) {
    db.prepare(
      "INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    ).run(key, value, now());
  },

  getEmailIntegrationRecord() {
    const row = db
      .prepare("SELECT * FROM email_integrations WHERE id='email'")
      .get() as Row | undefined;
    return row
      ? {
          serviceUrl: String(row.service_url),
          status: row.status as IntegrationStatus,
          lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
          lastError: row.last_error ? String(row.last_error) : null,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }
      : null;
  },
  saveEmailIntegration(input: {
    serviceUrl: string;
    status: IntegrationStatus;
    lastTestedAt: string | null;
    lastError: string | null;
  }) {
    const timestamp = now();
    db.prepare(
      `INSERT INTO email_integrations
        (id,service_url,status,last_tested_at,last_error,created_at,updated_at)
       VALUES ('email',?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        service_url=excluded.service_url,
        status=excluded.status,
        last_tested_at=excluded.last_tested_at,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at`,
    ).run(
      input.serviceUrl,
      input.status,
      input.lastTestedAt,
      input.lastError,
      this.getEmailIntegrationRecord()?.createdAt ?? timestamp,
      timestamp,
    );
    return this.getEmailIntegrationRecord()!;
  },
  listAgentEmailAccess(): AgentEmailAccess[] {
    const rows = db
      .prepare("SELECT * FROM agent_email_access ORDER BY profile_name")
      .all() as Row[];
    const accountStatement = db.prepare(
      "SELECT account_id FROM agent_email_accounts WHERE agent_id=? ORDER BY account_id",
    );
    return rows.map((row) =>
      mapAgentEmailAccess(
        row,
        (
          accountStatement.all(String(row.agent_id)) as Array<{
            account_id: string;
          }>
        ).map(({ account_id }) => account_id),
      ),
    );
  },
  getAgentEmailAccess(agentId: string) {
    const row = db
      .prepare("SELECT * FROM agent_email_access WHERE agent_id=?")
      .get(agentId) as Row | undefined;
    if (!row) return null;
    const accountIds = (
      db
        .prepare(
          "SELECT account_id FROM agent_email_accounts WHERE agent_id=? ORDER BY account_id",
        )
        .all(agentId) as Array<{ account_id: string }>
    ).map(({ account_id }) => account_id);
    return mapAgentEmailAccess(row, accountIds);
  },
  saveAgentEmailAccess(input: {
    agentId: string;
    profileId: string;
    profileName: string;
    accountIds: string[];
    readEnabled: boolean;
    draftEnabled: boolean;
    sendEnabled: boolean;
    sendPolicy: EmailSendPolicy;
    tokenId: string;
    tokenPrefix: string;
    tokenCreatedAt: string;
  }) {
    const current = this.getAgentEmailAccess(input.agentId);
    const timestamp = now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO agent_email_access
          (agent_id,profile_id,profile_name,read_enabled,draft_enabled,send_enabled,send_policy,token_id,token_prefix,token_created_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(agent_id) DO UPDATE SET
          profile_id=excluded.profile_id,
          profile_name=excluded.profile_name,
          read_enabled=excluded.read_enabled,
          draft_enabled=excluded.draft_enabled,
          send_enabled=excluded.send_enabled,
          send_policy=excluded.send_policy,
          token_id=excluded.token_id,
          token_prefix=excluded.token_prefix,
          token_created_at=excluded.token_created_at,
          updated_at=excluded.updated_at`,
      ).run(
        input.agentId,
        input.profileId,
        input.profileName,
        Number(input.readEnabled),
        Number(input.draftEnabled),
        Number(input.sendEnabled),
        input.sendPolicy,
        input.tokenId,
        input.tokenPrefix,
        input.tokenCreatedAt,
        current?.createdAt ?? timestamp,
        timestamp,
      );
      db.prepare("DELETE FROM agent_email_accounts WHERE agent_id=?").run(
        input.agentId,
      );
      const insert = db.prepare(
        "INSERT INTO agent_email_accounts (agent_id,account_id) VALUES (?,?)",
      );
      for (const accountId of [...new Set(input.accountIds)]) {
        insert.run(input.agentId, accountId);
      }
    })();
    return this.getAgentEmailAccess(input.agentId)!;
  },
  deleteAgentEmailAccess(agentId: string) {
    db.prepare("DELETE FROM agent_email_access WHERE agent_id=?").run(agentId);
  },

  listIntegrationRecords() {
    return (
      db.prepare("SELECT * FROM integrations ORDER BY name").all() as Row[]
    ).map(mapIntegrationRecord);
  },
  getIntegrationRecord(id: string) {
    const row = db.prepare("SELECT * FROM integrations WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapIntegrationRecord(row) : null;
  },
  getIntegrationRecordByProvider(provider: IntegrationProvider) {
    const rows = db
      .prepare(
        "SELECT * FROM integrations WHERE provider=? ORDER BY created_at",
      )
      .all(provider) as Row[];
    if (!rows.length) return null;
    if (rows.length === 1 || provider === "posthog") {
      return mapIntegrationRecord(rows[0]);
    }
    return null;
  },
  listIntegrationPermissions(integrationId: string) {
    const rows = db
      .prepare(
        "SELECT agent_id,tool_key FROM agent_integration_tools WHERE integration_id=? ORDER BY agent_id,tool_key",
      )
      .all(integrationId) as Array<{ agent_id: string; tool_key: string }>;
    return rows.reduce<Record<string, string[]>>((result, row) => {
      (result[row.agent_id] ??= []).push(row.tool_key);
      return result;
    }, {});
  },
  setAgentIntegrationTools(
    integrationId: string,
    agentId: string,
    toolKeys: string[],
  ) {
    const timestamp = now();
    const transaction = db.transaction(() => {
      db.prepare(
        "DELETE FROM agent_integration_tools WHERE integration_id=? AND agent_id=?",
      ).run(integrationId, agentId);
      const insert = db.prepare(
        "INSERT INTO agent_integration_tools (agent_id,integration_id,tool_key,created_at) VALUES (?,?,?,?)",
      );
      for (const toolKey of [...new Set(toolKeys)]) {
        insert.run(agentId, integrationId, toolKey, timestamp);
      }
    });
    transaction();
    return this.getIntegration(integrationId);
  },
  listCustomHttpOperations(integrationId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM custom_http_operations WHERE integration_id=? ORDER BY key",
        )
        .all(integrationId) as Row[]
    ).map(mapCustomHttpOperation);
  },
  listCustomMcpTools(integrationId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM custom_mcp_tools WHERE integration_id=? ORDER BY name",
        )
        .all(integrationId) as Row[]
    ).map(mapCustomMcpTool);
  },
  listIntegrations() {
    return this.listIntegrationRecords().map((record) =>
      mapIntegration(
        record,
        this.listIntegrationPermissions(record.id),
        record.provider === "custom_http"
          ? this.listCustomHttpOperations(record.id)
          : [],
        record.provider === "custom_mcp"
          ? this.listCustomMcpTools(record.id)
          : [],
      ),
    );
  },
  getIntegration(idOrProvider: string) {
    const record =
      this.getIntegrationRecord(idOrProvider) ??
      this.getIntegrationRecordByProvider(
        idOrProvider as IntegrationProvider,
      ) ??
      null;
    return record
      ? mapIntegration(
          record,
          this.listIntegrationPermissions(record.id),
          record.provider === "custom_http"
            ? this.listCustomHttpOperations(record.id)
            : [],
          record.provider === "custom_mcp"
            ? this.listCustomMcpTools(record.id)
            : [],
        )
      : null;
  },
  saveIntegration(input: {
    id?: string;
    provider: IntegrationProvider;
    name: string;
    config: IntegrationRecord["config"];
    credentialsCiphertext: string;
    status: IntegrationStatus;
    lastTestedAt: string | null;
    lastError: string | null;
    enabled?: boolean;
    permissions: Record<string, string[]>;
    version?: number;
    operations?: IntegrationHttpOperation[];
    mcpTools?: IntegrationMcpTool[];
    expectedVersion?: number;
  }) {
    const current = input.id
      ? this.getIntegrationRecord(input.id)
      : input.provider === "posthog"
        ? this.getIntegrationRecordByProvider(input.provider)
        : null;
    const id = current?.id ?? input.id ?? randomUUID();
    const timestamp = now();
    const enabled = input.enabled ?? true;
    const operations =
      input.operations ??
      (input.provider === "custom_http"
        ? this.listCustomHttpOperations(id)
        : []);
    const mcpTools =
      input.mcpTools ??
      (input.provider === "custom_mcp" ? this.listCustomMcpTools(id) : []);
    const transaction = db.transaction(() => {
      if (input.expectedVersion !== undefined) {
        const live = this.getIntegrationRecord(id);
        if (!live || live.version !== input.expectedVersion) {
          throw new Error(
            "Integration changed while it was being saved. Reload the current configuration and try again.",
          );
        }
      }
      db.prepare(
        `INSERT INTO integrations
          (id,provider,name,slug,config_json,credentials_ciphertext,enabled,version,status,last_tested_at,last_error,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           slug=excluded.slug,
           config_json=excluded.config_json,
           credentials_ciphertext=excluded.credentials_ciphertext,
           enabled=excluded.enabled,
           version=excluded.version,
           status=excluded.status,
           last_tested_at=excluded.last_tested_at,
           last_error=excluded.last_error,
           updated_at=excluded.updated_at`,
      ).run(
        id,
        input.provider,
        input.name,
        current?.slug ?? normalizeSlug(input.name),
        JSON.stringify(input.config),
        input.credentialsCiphertext,
        Number(enabled),
        input.version ?? (current?.version ?? 0) + 1,
        input.status,
        input.lastTestedAt,
        input.lastError,
        current?.createdAt ?? timestamp,
        timestamp,
      );
      const saved = this.getIntegrationRecord(id);
      if (!saved) throw new Error("Integration could not be saved.");
      db.prepare(
        "DELETE FROM agent_integration_tools WHERE integration_id=?",
      ).run(saved.id);
      const insert = db.prepare(
        "INSERT INTO agent_integration_tools (agent_id,integration_id,tool_key,created_at) VALUES (?,?,?,?)",
      );
      for (const [agentId, toolKeys] of Object.entries(input.permissions)) {
        for (const toolKey of [...new Set(toolKeys)]) {
          insert.run(agentId, saved.id, toolKey, timestamp);
        }
      }
      if (saved.provider === "custom_http") {
        db.prepare(
          "DELETE FROM custom_http_operations WHERE integration_id=?",
        ).run(saved.id);
        const insertOperation = db.prepare(
          "INSERT INTO custom_http_operations (id,integration_id,key,name,description,method,path,parameters_json,response_path,max_response_bytes,max_items,enabled,timeout_ms,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        );
        for (const operation of operations) {
          insertOperation.run(
            operation.id || randomUUID(),
            saved.id,
            operation.key,
            operation.name,
            operation.description,
            operation.method,
            operation.path,
            JSON.stringify(operation.parameters),
            operation.responsePath ?? null,
            operation.maxResponseBytes,
            operation.maxItems,
            Number(operation.enabled),
            operation.timeoutMs,
            operation.createdAt || timestamp,
            timestamp,
          );
        }
      }
      if (saved.provider === "custom_mcp") {
        db.prepare("DELETE FROM custom_mcp_tools WHERE integration_id=?").run(
          saved.id,
        );
        const insertTool = db.prepare(
          "INSERT INTO custom_mcp_tools (id,integration_id,name,description,input_schema_json,read_only_hint,destructive_hint,idempotent_hint,open_world_hint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        );
        for (const tool of mcpTools) {
          insertTool.run(
            randomUUID(),
            saved.id,
            tool.name,
            tool.description,
            JSON.stringify(tool.inputSchema),
            Number(tool.readOnlyHint),
            Number(tool.destructiveHint),
            tool.idempotentHint,
            tool.openWorldHint,
            timestamp,
            timestamp,
          );
        }
      }
      return saved.id;
    });
    return this.getIntegration(transaction())!;
  },
  updateIntegrationCheck(
    id: string,
    input: {
      status: IntegrationStatus;
      lastTestedAt: string;
      lastError: string | null;
    },
  ) {
    db.prepare(
      "UPDATE integrations SET status=?,last_tested_at=?,last_error=?,updated_at=? WHERE id=?",
    ).run(input.status, input.lastTestedAt, input.lastError, now(), id);
    return this.getIntegration(id);
  },
  updateIntegrationCheckIfVersion(
    id: string,
    expectedVersion: number,
    input: {
      status: IntegrationStatus;
      lastTestedAt: string;
      lastError: string | null;
    },
  ) {
    const result = db
      .prepare(
        "UPDATE integrations SET status=?,last_tested_at=?,last_error=?,updated_at=? WHERE id=? AND version=?",
      )
      .run(
        input.status,
        input.lastTestedAt,
        input.lastError,
        now(),
        id,
        expectedVersion,
      );
    return result.changes === 1 ? this.getIntegration(id) : null;
  },
  completeIntegrationTest(input: {
    id: string;
    expectedVersion: number;
    status: IntegrationStatus;
    testedAt: string;
    lastError: string | null;
    accountEmail?: string;
    accountName?: string;
  }) {
    const transaction = db.transaction(() => {
      const current = db
        .prepare("SELECT * FROM integrations WHERE id=? AND version=?")
        .get(input.id, input.expectedVersion) as Row | undefined;
      if (!current) return false;
      const config = json(
        current.config_json,
        {},
      ) as IntegrationRecord["config"];
      const result = db
        .prepare(
          `UPDATE integrations SET config_json=?,status=?,last_tested_at=?,last_error=?,updated_at=?
           WHERE id=? AND version=?`,
        )
        .run(
          JSON.stringify({
            ...config,
            accountEmail: input.accountEmail ?? config.accountEmail ?? null,
            accountName: input.accountName ?? config.accountName ?? null,
          }),
          input.status,
          input.testedAt,
          input.lastError,
          input.testedAt,
          input.id,
          input.expectedVersion,
        );
      return result.changes === 1;
    });
    return transaction();
  },
  updateIntegrationCredentials(id: string, credentialsCiphertext: string) {
    db.prepare(
      "UPDATE integrations SET credentials_ciphertext=?,updated_at=? WHERE id=?",
    ).run(credentialsCiphertext, now(), id);
    return this.getIntegrationRecord(id);
  },
  updateIntegrationCredentialsIfCurrent(input: {
    id: string;
    expectedVersion: number;
    expectedCredentialsCiphertext: string;
    credentialsCiphertext: string;
  }) {
    const result = db
      .prepare(
        `UPDATE integrations SET credentials_ciphertext=?,updated_at=?
         WHERE id=? AND version=? AND credentials_ciphertext=?`,
      )
      .run(
        input.credentialsCiphertext,
        now(),
        input.id,
        input.expectedVersion,
        input.expectedCredentialsCiphertext,
      );
    return result.changes === 1;
  },
  completeCalendarOAuth(input: {
    id: string;
    provider: "calendar_google" | "calendar_microsoft";
    expectedVersion: number;
    credentialsCiphertext: string;
    accountEmail?: string;
    accountName?: string;
    testedAt: string;
  }) {
    const transaction = db.transaction(() => {
      const current = db
        .prepare(
          "SELECT * FROM integrations WHERE id=? AND provider=? AND version=?",
        )
        .get(input.id, input.provider, input.expectedVersion) as
        Row | undefined;
      if (!current) return false;
      const config = json(
        current.config_json,
        {},
      ) as IntegrationRecord["config"];
      const result = db
        .prepare(
          `UPDATE integrations SET config_json=?,credentials_ciphertext=?,status=?,last_tested_at=?,last_error=NULL,version=version+1,updated_at=?
           WHERE id=? AND provider=? AND version=?`,
        )
        .run(
          JSON.stringify({
            ...config,
            accountEmail: input.accountEmail ?? null,
            accountName: input.accountName ?? null,
            oauthConfigured: true,
          }),
          input.credentialsCiphertext,
          bool(current.enabled) ? "connected" : "disabled",
          input.testedAt,
          input.testedAt,
          input.id,
          input.provider,
          input.expectedVersion,
        );
      return result.changes === 1;
    });
    return transaction();
  },
  deleteIntegration(id: string) {
    const existing = this.getIntegrationRecord(id);
    if (!existing) return false;
    db.prepare("DELETE FROM integrations WHERE id=?").run(id);
    return true;
  },
  getRunIntegrationCapability(runId: string, integrationId: string) {
    const row = db
      .prepare(
        "SELECT * FROM run_integration_capabilities WHERE run_id=? AND integration_id=?",
      )
      .get(runId, integrationId) as Row | undefined;
    return row ? mapRunIntegrationCapability(row) : null;
  },
  listRunIntegrationCapabilities(runId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM run_integration_capabilities WHERE run_id=? ORDER BY integration_id",
        )
        .all(runId) as Row[]
    ).map(mapRunIntegrationCapability);
  },
  hasRunIntegrationSnapshot(runId: string, scope: string) {
    return Boolean(
      db
        .prepare(
          "SELECT 1 FROM run_integration_snapshot_markers WHERE run_id=? AND scope=?",
        )
        .get(runId, scope),
    );
  },
  markRunIntegrationSnapshot(runId: string, scope: string) {
    const result = db
      .prepare(
        `INSERT INTO run_integration_snapshot_markers (run_id,scope,captured_at)
       VALUES (?,?,?) ON CONFLICT(run_id,scope) DO NOTHING`,
      )
      .run(runId, scope, now());
    return result.changes === 1;
  },
  saveRunIntegrationCapability(input: {
    runId: string;
    integrationId: string;
    agentId: string;
    integrationVersion: number;
    tokenHash: string;
    allowedTools: string[];
  }) {
    const timestamp = now();
    const current = this.getRunIntegrationCapability(
      input.runId,
      input.integrationId,
    );
    db.prepare(
      `INSERT INTO run_integration_capabilities
        (run_id,integration_id,agent_id,integration_version,token_hash,allowed_tools_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(run_id,integration_id) DO UPDATE SET
        token_hash=excluded.token_hash,
        updated_at=excluded.updated_at`,
    ).run(
      input.runId,
      input.integrationId,
      input.agentId,
      input.integrationVersion,
      input.tokenHash,
      JSON.stringify([...new Set(input.allowedTools)]),
      current?.createdAt ?? timestamp,
      timestamp,
    );
    return this.getRunIntegrationCapability(input.runId, input.integrationId)!;
  },

  listAgents() {
    return (
      db
        .prepare("SELECT * FROM agents ORDER BY enabled DESC, name")
        .all() as Row[]
    ).map(mapAgent);
  },
  getAgent(id: string) {
    const row = db
      .prepare("SELECT * FROM agents WHERE id = ? OR slug = ?")
      .get(id, id) as Row | undefined;
    return row ? mapAgent(row) : null;
  },
  createAgent(
    input: Pick<
      Agent,
      | "name"
      | "slug"
      | "role"
      | "instructions"
      | "model"
      | "enabled"
      | "fullAccess"
    >,
  ) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO agents (id,name,slug,role,instructions,runtime,model,enabled,full_access,created_at,updated_at) VALUES (?,?,?,?,?,'codex',?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.slug,
      input.role,
      input.instructions,
      input.model,
      input.enabled ? 1 : 0,
      input.fullAccess ? 1 : 0,
      timestamp,
      timestamp,
    );
    return this.getAgent(id)!;
  },
  listAgentQuickActions(agentId?: string) {
    const rows = agentId
      ? db
          .prepare(
            "SELECT * FROM agent_quick_actions WHERE agent_id=? ORDER BY position,label",
          )
          .all(agentId)
      : db
          .prepare(
            "SELECT * FROM agent_quick_actions ORDER BY agent_id,position,label",
          )
          .all();
    return (rows as Row[]).map(mapAgentQuickAction);
  },
  getAgentQuickAction(id: string) {
    const row = db
      .prepare("SELECT * FROM agent_quick_actions WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapAgentQuickAction(row) : null;
  },
  createAgentQuickAction(
    agentId: string,
    input: Pick<AgentQuickAction, "label" | "prompt">,
  ) {
    const id = randomUUID();
    const timestamp = now();
    const position = Number(
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM agent_quick_actions WHERE agent_id=?",
          )
          .get(agentId) as Row
      ).position,
    );
    db.prepare(
      "INSERT INTO agent_quick_actions (id,agent_id,label,prompt,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id,
      agentId,
      input.label,
      input.prompt,
      position,
      timestamp,
      timestamp,
    );
    return this.getAgentQuickAction(id)!;
  },
  updateAgentQuickAction(
    id: string,
    input: Partial<Pick<AgentQuickAction, "label" | "prompt">>,
  ) {
    const current = this.getAgentQuickAction(id);
    if (!current) return null;
    db.prepare(
      "UPDATE agent_quick_actions SET label=?,prompt=?,updated_at=? WHERE id=?",
    ).run(
      input.label ?? current.label,
      input.prompt ?? current.prompt,
      now(),
      id,
    );
    return this.getAgentQuickAction(id);
  },
  deleteAgentQuickAction(id: string) {
    return db.prepare("DELETE FROM agent_quick_actions WHERE id=?").run(id)
      .changes;
  },
  updateAgent(
    id: string,
    input: Partial<
      Pick<
        Agent,
        "name" | "role" | "instructions" | "model" | "enabled" | "fullAccess"
      >
    >,
  ) {
    const current = this.getAgent(id);
    if (!current) return null;
    db.prepare(
      "UPDATE agents SET name=?, role=?, instructions=?, model=?, enabled=?, full_access=?, updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.role ?? current.role,
      input.instructions ?? current.instructions,
      input.model ?? current.model,
      (input.enabled ?? current.enabled) ? 1 : 0,
      (input.fullAccess ?? current.fullAccess) ? 1 : 0,
      now(),
      current.id,
    );
    return this.getAgent(current.id);
  },

  getWorkCoordinationItem(issueKey: string) {
    return db
      .prepare("SELECT * FROM work_coordination_items WHERE issue_key=?")
      .get(issueKey) as Row | undefined;
  },
  upsertWorkCoordinationItem(input: {
    issueKey: string;
    projectKey: string;
    assignee: string | null;
    semanticStatus: string;
    remoteUpdatedAt: string | null;
    labels: string[];
  }) {
    const timestamp = now();
    db.prepare(
      `INSERT INTO work_coordination_items
        (issue_key,project_key,assignee,semantic_status,remote_updated_at,labels_json,first_seen_at,last_seen_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(issue_key) DO UPDATE SET
        project_key=excluded.project_key,
        assignee=excluded.assignee,
        semantic_status=excluded.semantic_status,
        remote_updated_at=excluded.remote_updated_at,
        labels_json=excluded.labels_json,
        last_seen_at=excluded.last_seen_at`,
    ).run(
      input.issueKey,
      input.projectKey,
      input.assignee,
      input.semanticStatus,
      input.remoteUpdatedAt,
      JSON.stringify(input.labels),
      timestamp,
      timestamp,
    );
  },
  claimWorkCoordinationEvent(input: {
    dedupeKey: string;
    issueKey: string;
    type: "assignment" | "resumed" | "review_requested" | "blocked" | "mention";
    agentId: string;
    commentId?: string | null;
  }) {
    const id = randomUUID();
    const timestamp = now();
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO work_coordination_events
          (id,dedupe_key,issue_key,type,agent_id,comment_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.dedupeKey,
        input.issueKey,
        input.type,
        input.agentId,
        input.commentId ?? null,
        timestamp,
        timestamp,
      );
    return result.changes > 0 ? id : null;
  },
  completeWorkCoordinationEvent(
    id: string,
    input: { runId?: string; error?: string },
  ) {
    db.prepare(
      "UPDATE work_coordination_events SET run_id=?,error=?,updated_at=? WHERE id=?",
    ).run(input.runId ?? null, input.error ?? null, now(), id);
  },
  hasSeenWorkComment(commentId: string) {
    return Boolean(
      db
        .prepare(
          "SELECT comment_id FROM work_coordination_comments WHERE comment_id=?",
        )
        .get(commentId),
    );
  },
  rememberWorkComment(issueKey: string, commentId: string) {
    return (
      db
        .prepare(
          "INSERT OR IGNORE INTO work_coordination_comments (comment_id,issue_key,first_seen_at) VALUES (?,?,?)",
        )
        .run(commentId, issueKey, now()).changes > 0
    );
  },
  getWorkAgentThread(issueKey: string, agentId: string) {
    const row = db
      .prepare(
        `SELECT t.* FROM work_agent_threads w
         JOIN threads t ON t.id=w.thread_id
         WHERE w.issue_key=? AND w.agent_id=?`,
      )
      .get(issueKey, agentId) as Row | undefined;
    return row ? mapThread(row) : null;
  },
  getOrCreateWorkAgentThread(issueKey: string, agentId: string, title: string) {
    const existing = this.getWorkAgentThread(issueKey, agentId);
    if (existing) return existing;
    const thread = this.createThread(agentId, title);
    db.prepare(
      "INSERT INTO work_agent_threads (issue_key,agent_id,thread_id,created_at) VALUES (?,?,?,?)",
    ).run(issueKey, agentId, thread.id, now());
    return thread;
  },
  getActiveRunForThread(threadId: string) {
    const row = db
      .prepare(
        "SELECT * FROM runs WHERE thread_id=? AND status IN ('queued','running','waiting_approval') ORDER BY rowid DESC LIMIT 1",
      )
      .get(threadId) as Row | undefined;
    return row ? mapRun(row) : null;
  },

  listThreads(agentId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM threads WHERE agent_id=? ORDER BY updated_at DESC",
        )
        .all(agentId) as Row[]
    ).map(mapThread);
  },
  getThread(id: string) {
    const row = db.prepare("SELECT * FROM threads WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapThread(row) : null;
  },
  createThread(agentId: string, title: string) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO threads (id,agent_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run(id, agentId, title, timestamp, timestamp);
    return this.getThread(id)!;
  },
  setRuntimeThread(id: string, runtimeThreadId: string | null) {
    db.prepare(
      "UPDATE threads SET runtime_thread_id=?, updated_at=? WHERE id=?",
    ).run(runtimeThreadId, now(), id);
  },
  touchThread(id: string) {
    db.prepare("UPDATE threads SET updated_at=? WHERE id=?").run(now(), id);
  },
  listMessages(threadId: string) {
    return (
      db
        .prepare("SELECT * FROM messages WHERE thread_id=? ORDER BY created_at")
        .all(threadId) as Row[]
    ).map(mapMessage);
  },
  getRunInput(runId: string) {
    const row = db
      .prepare(
        "SELECT * FROM messages WHERE run_id=? AND role='user' ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId) as Row | undefined;
    return row ? mapMessage(row) : null;
  },
  addMessage(
    threadId: string,
    runId: string | null,
    role: Message["role"],
    body: string,
  ) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO messages (id,thread_id,run_id,role,body,created_at) VALUES (?,?,?,?,?,?)",
    ).run(id, threadId, runId, role, body, now());
    this.touchThread(threadId);
    return mapMessage(
      db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Row,
    );
  },

  createRun(input: {
    agentId: string;
    threadId?: string | null;
    automationId?: string | null;
    runtime?: string;
    trigger: Run["trigger"];
    mode: Run["mode"];
    issueKey?: string | null;
    runInstructions: string;
  }) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO runs (id,agent_id,thread_id,automation_id,status,runtime,trigger,mode,issue_key,run_instructions) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.agentId,
      input.threadId ?? null,
      input.automationId ?? null,
      "queued",
      input.runtime ?? "codex",
      input.trigger,
      input.mode,
      input.issueKey ?? null,
      input.runInstructions,
    );
    return this.getRun(id)!;
  },
  getRun(id: string) {
    const row = db.prepare("SELECT * FROM runs WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapRun(row) : null;
  },
  listRuns(limit = 100) {
    return (
      db
        .prepare(
          "SELECT * FROM runs ORDER BY COALESCE(started_at,'') DESC, rowid DESC LIMIT ?",
        )
        .all(limit) as Row[]
    ).map(mapRun);
  },
  updateRun(
    id: string,
    status: RunStatus,
    extra: {
      error?: string | null;
      usage?: Record<string, unknown> | null;
    } = {},
  ) {
    const run = this.getRun(id);
    if (!run) return null;
    const started = run.startedAt ?? (status !== "queued" ? now() : null);
    const completed = ["completed", "failed", "skipped", "cancelled"].includes(
      status,
    )
      ? now()
      : null;
    db.prepare(
      "UPDATE runs SET status=?,started_at=?,completed_at=?,error=?,usage_json=? WHERE id=?",
    ).run(
      status,
      started,
      completed,
      extra.error ?? run.error,
      extra.usage
        ? JSON.stringify(extra.usage)
        : run.usage
          ? JSON.stringify(run.usage)
          : null,
      id,
    );
    return this.getRun(id);
  },
  addRunEvent(
    runId: string,
    type: string,
    payload: Record<string, unknown> = {},
  ) {
    const id = randomUUID(),
      createdAt = now();
    db.prepare(
      "INSERT INTO run_events (id,run_id,type,payload,created_at) VALUES (?,?,?,?,?)",
    ).run(id, runId, type, JSON.stringify(payload), createdAt);
    return { id, runId, type, payload, createdAt } satisfies RunEvent;
  },
  listRunEvents(runId: string) {
    return (
      db
        .prepare("SELECT * FROM run_events WHERE run_id=? ORDER BY created_at")
        .all(runId) as Row[]
    ).map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      type: String(row.type),
      payload: json(row.payload, {}),
      createdAt: String(row.created_at),
    }));
  },

  listAutomations() {
    return (
      db
        .prepare(
          `SELECT a.*, g.name agent_name,
            (SELECT r.id FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_id
           FROM automations a
           JOIN agents g ON g.id=a.agent_id
           ORDER BY a.enabled DESC,a.name`,
        )
        .all() as Row[]
    ).map(mapAutomation);
  },
  getAutomation(id: string) {
    const row = db
      .prepare(
        `SELECT a.*, g.name agent_name,
          (SELECT r.id FROM runs r WHERE r.automation_id=a.id ORDER BY r.rowid DESC LIMIT 1) last_run_id
         FROM automations a
         JOIN agents g ON g.id=a.agent_id
         WHERE a.id=?`,
      )
      .get(id) as Row | undefined;
    return row ? mapAutomation(row) : null;
  },
  createAutomation(input: {
    name: string;
    agentId: string;
    cronExpression: string | null;
    prompt: string;
    mode: Automation["mode"];
    enabled: boolean;
  }) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO automations (id,name,agent_id,cron_expression,prompt,mode,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.agentId,
      input.cronExpression,
      input.prompt,
      input.mode,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp,
    );
    return this.getAutomation(id)!;
  },
  updateAutomation(
    id: string,
    input: Partial<{
      name: string;
      cronExpression: string | null;
      prompt: string;
      mode: Automation["mode"];
      enabled: boolean;
      lastRunAt: string | null;
    }>,
  ) {
    const current = this.getAutomation(id);
    if (!current) return null;
    db.prepare(
      "UPDATE automations SET name=?,cron_expression=?,prompt=?,mode=?,enabled=?,last_run_at=?,updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.cronExpression === undefined
        ? current.cronExpression
        : input.cronExpression,
      input.prompt ?? current.prompt,
      input.mode ?? current.mode,
      (input.enabled ?? current.enabled) ? 1 : 0,
      input.lastRunAt === undefined ? current.lastRunAt : input.lastRunAt,
      now(),
      id,
    );
    return this.getAutomation(id);
  },

  createApproval(
    runId: string,
    runnerApprovalId: string,
    command: string,
    details: Record<string, unknown>,
  ) {
    const id = randomUUID(),
      createdAt = now();
    db.prepare(
      "INSERT INTO approvals (id,run_id,runner_approval_id,command,details_json,status,created_at) VALUES (?,?,?,?,?,'pending',?)",
    ).run(
      id,
      runId,
      runnerApprovalId,
      command,
      JSON.stringify(details),
      createdAt,
    );
    return this.getApproval(id)!;
  },
  getApproval(id: string) {
    const row = db.prepare("SELECT * FROM approvals WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapApproval(row) : null;
  },
  listApprovals(status?: Approval["status"]) {
    const rows = status
      ? db
          .prepare(
            "SELECT * FROM approvals WHERE status=? ORDER BY created_at DESC",
          )
          .all(status)
      : db.prepare("SELECT * FROM approvals ORDER BY created_at DESC").all();
    return (rows as Row[]).map(mapApproval);
  },
  claimApproval(id: string) {
    const result = db
      .prepare(
        "UPDATE approvals SET status='resolving' WHERE id=? AND status='pending'",
      )
      .run(id);
    return result.changes === 1 ? this.getApproval(id) : null;
  },
  releaseApproval(id: string) {
    db.prepare(
      "UPDATE approvals SET status='pending' WHERE id=? AND status='resolving'",
    ).run(id);
  },
  resolveApproval(id: string, status: "approved" | "denied") {
    const result = db
      .prepare(
        "UPDATE approvals SET status=?,resolved_at=? WHERE id=? AND status='resolving'",
      )
      .run(status, now(), id);
    return result.changes === 1 ? this.getApproval(id) : null;
  },
  closePendingApprovals(runId: string) {
    return db
      .prepare(
        "UPDATE approvals SET status='denied',resolved_at=? WHERE run_id=? AND status IN ('pending','resolving')",
      )
      .run(now(), runId).changes;
  },
};
