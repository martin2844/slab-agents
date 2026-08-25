import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";
import type {
  Agent,
  AgentQuickAction,
  AgentEmailAccess,
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
  OperatorPackAcceptance,
  OperatorPackAcceptanceStatus,
  OperatorPackInstallation,
  OperatorPackInstallationStatus,
  OperatorPackResource,
  OperatorPackResourceType,
  Run,
  RunEvent,
  RunStatus,
  Thread,
} from "@/lib/types";
import type { OperatorPackManifest } from "@/lib/packs/manifest";
import { POSTHOG_TOOLS } from "@/lib/integrations/catalog";
import {
  normalizeIntegrationSlug,
  normalizeIntegrationToolKey,
} from "@/lib/integrations/naming";
import { IntegrationVersionConflictError } from "@/lib/integrations/errors";

type Row = Record<string, unknown>;
const bool = (value: unknown) => Boolean(value);
const json = <T>(value: unknown, fallback: T): T => {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch (error) {
    throw new Error("Stored JSON is corrupt.", { cause: error });
  }
};
const telemetryJson = <T>(value: unknown, fallback: T): T => {
  try {
    return json(value, fallback);
  } catch (error) {
    console.error("[repository] corrupt telemetry JSON", error);
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
    runtime: String(row.runtime ?? "codex"),
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
    runtime: row.runtime ? String(row.runtime) : null,
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
    model: String(row.model ?? "default"),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    error: row.error ? String(row.error) : null,
    usage: telemetryJson(row.usage_json, null),
    createdAt: String(row.created_at ?? row.started_at ?? ""),
    queuedAt: String(row.queued_at ?? row.created_at ?? row.started_at ?? ""),
    attemptCount: Number(row.attempt_count ?? 0),
    runnerRunId: row.runner_run_id ? String(row.runner_run_id) : null,
    runnerEventId: Number(row.runner_event_id ?? 0),
  };
}

export type RuntimeConfigRecord = {
  runtimeId: string;
  enabled: boolean;
  authMode: "runtime_owned" | "api_key";
  credentialCiphertext: string | null;
  baseUrl: string | null;
  apiFormat: "responses" | "chat_completions" | null;
  defaultModel: string;
  models: string[];
  configVersion: number;
  lastVerificationStatus: "connected" | "failed" | null;
  lastVerificationDetail: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRuntimeConfig(row: Row): RuntimeConfigRecord {
  return {
    runtimeId: String(row.runtime_id),
    enabled: bool(row.enabled),
    authMode: row.auth_mode as RuntimeConfigRecord["authMode"],
    credentialCiphertext: row.credential_ciphertext
      ? String(row.credential_ciphertext)
      : null,
    baseUrl: row.base_url ? String(row.base_url) : null,
    apiFormat: row.api_format
      ? (String(row.api_format) as RuntimeConfigRecord["apiFormat"])
      : null,
    defaultModel: String(row.default_model ?? "default"),
    models: json(row.models_json, ["default"]),
    configVersion: Number(row.config_version ?? 1),
    lastVerificationStatus: row.last_verification_status
      ? (String(
          row.last_verification_status,
        ) as RuntimeConfigRecord["lastVerificationStatus"])
      : null,
    lastVerificationDetail: row.last_verification_detail
      ? String(row.last_verification_detail)
      : null,
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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
    lastScheduledFor: row.last_scheduled_for
      ? String(row.last_scheduled_for)
      : null,
    missedRunPolicy: row.missed_run_policy === "skip" ? "skip" : "latest_once",
    lastRunId: row.last_run_id ? String(row.last_run_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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

function mapOperatorPackInstallation(row: Row): OperatorPackInstallation {
  return {
    packId: String(row.pack_id),
    packVersion: String(row.pack_version),
    source: row.source === "local" ? "local" : "official",
    status: row.status as OperatorPackInstallationStatus,
    manifest: json(row.manifest_json, {}) as OperatorPackManifest,
    lastError: row.last_error ? String(row.last_error) : null,
    installedAt: String(row.installed_at),
    disabledAt: row.disabled_at ? String(row.disabled_at) : null,
    updatedAt: String(row.updated_at),
  };
}

function mapOperatorPackResource(row: Row): OperatorPackResource {
  return {
    id: String(row.id),
    packId: String(row.pack_id),
    resourceType: row.resource_type as OperatorPackResourceType,
    resourceKey: String(row.resource_key),
    resourceId: row.resource_id ? String(row.resource_id) : null,
    managed: bool(row.managed),
    createdByPack: bool(row.created_by_pack),
    reattachable: bool(row.reattachable),
    state: row.state as OperatorPackResource["state"],
    baseline: json(row.baseline_json, {}),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapOperatorPackAcceptance(row: Row): OperatorPackAcceptance {
  return {
    id: String(row.id),
    packId: String(row.pack_id),
    scenarioId: String(row.scenario_id),
    packVersion: String(row.pack_version),
    runId: row.run_id ? String(row.run_id) : null,
    projectKey: row.project_key ? String(row.project_key) : null,
    issueKey: row.issue_key ? String(row.issue_key) : null,
    docId: row.doc_id ? String(row.doc_id) : null,
    status: row.status as OperatorPackAcceptanceStatus,
    rubric: json(row.rubric_json, {}),
    evidence: json(row.evidence_json, {}),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
  };
}

export const repository = {
  transaction<T>(callback: () => T) {
    return db.transaction(callback).immediate();
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
  listOperatorPackDefinitions() {
    return (
      db
        .prepare(
          "SELECT id,version,manifest_json,source,created_at,updated_at FROM operator_pack_definitions ORDER BY id",
        )
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      version: String(row.version),
      manifest: json(row.manifest_json, {}) as OperatorPackManifest,
      source: "local" as const,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  },
  getOperatorPackDefinition(id: string) {
    const row = db
      .prepare(
        "SELECT id,version,manifest_json,source,created_at,updated_at FROM operator_pack_definitions WHERE id=?",
      )
      .get(id) as Row | undefined;
    return row
      ? {
          id: String(row.id),
          version: String(row.version),
          manifest: json(row.manifest_json, {}) as OperatorPackManifest,
          source: "local" as const,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }
      : null;
  },
  saveOperatorPackDefinition(manifest: OperatorPackManifest) {
    const timestamp = now();
    const current = this.getOperatorPackDefinition(manifest.id);
    db.prepare(
      `INSERT INTO operator_pack_definitions
        (id,version,manifest_json,source,created_at,updated_at)
       VALUES (?,?,?,'local',?,?)
       ON CONFLICT(id) DO UPDATE SET
        version=excluded.version,
        manifest_json=excluded.manifest_json,
        updated_at=excluded.updated_at`,
    ).run(
      manifest.id,
      manifest.version,
      JSON.stringify(manifest),
      current?.createdAt ?? timestamp,
      timestamp,
    );
    return this.getOperatorPackDefinition(manifest.id)!;
  },
  deleteOperatorPackDefinition(id: string) {
    return db
      .prepare("DELETE FROM operator_pack_definitions WHERE id=?")
      .run(id).changes;
  },

  listOperatorPackInstallations() {
    return (
      db
        .prepare(
          "SELECT * FROM operator_pack_installations ORDER BY installed_at",
        )
        .all() as Row[]
    ).map(mapOperatorPackInstallation);
  },
  getOperatorPackInstallation(packId: string) {
    const row = db
      .prepare("SELECT * FROM operator_pack_installations WHERE pack_id=?")
      .get(packId) as Row | undefined;
    return row ? mapOperatorPackInstallation(row) : null;
  },
  saveOperatorPackInstallation(input: {
    packId: string;
    packVersion: string;
    source: "official" | "local";
    status: OperatorPackInstallationStatus;
    manifest: OperatorPackManifest;
    lastError?: string | null;
    disabledAt?: string | null;
  }) {
    const timestamp = now();
    const current = this.getOperatorPackInstallation(input.packId);
    db.prepare(
      `INSERT INTO operator_pack_installations
        (pack_id,pack_version,source,status,manifest_json,last_error,installed_at,disabled_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(pack_id) DO UPDATE SET
        pack_version=excluded.pack_version,
        source=excluded.source,
        status=excluded.status,
        manifest_json=excluded.manifest_json,
        last_error=excluded.last_error,
        disabled_at=excluded.disabled_at,
        updated_at=excluded.updated_at`,
    ).run(
      input.packId,
      input.packVersion,
      input.source,
      input.status,
      JSON.stringify(input.manifest),
      input.lastError ?? null,
      current?.installedAt ?? timestamp,
      input.disabledAt ?? null,
      timestamp,
    );
    return this.getOperatorPackInstallation(input.packId)!;
  },

  listOperatorPackResources(packId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM operator_pack_resources WHERE pack_id=? ORDER BY resource_type,resource_key",
        )
        .all(packId) as Row[]
    ).map(mapOperatorPackResource);
  },
  getOperatorPackResource(
    packId: string,
    resourceType: OperatorPackResourceType,
    resourceKey: string,
  ) {
    const row = db
      .prepare(
        "SELECT * FROM operator_pack_resources WHERE pack_id=? AND resource_type=? AND resource_key=?",
      )
      .get(packId, resourceType, resourceKey) as Row | undefined;
    return row ? mapOperatorPackResource(row) : null;
  },
  saveOperatorPackResource(input: {
    packId: string;
    resourceType: OperatorPackResourceType;
    resourceKey: string;
    resourceId: string | null;
    managed: boolean;
    createdByPack: boolean;
    reattachable: boolean;
    state: OperatorPackResource["state"];
    baseline: Record<string, unknown>;
    lastError?: string | null;
  }) {
    const timestamp = now();
    const current = this.getOperatorPackResource(
      input.packId,
      input.resourceType,
      input.resourceKey,
    );
    const id = current?.id ?? randomUUID();
    db.prepare(
      `INSERT INTO operator_pack_resources
        (id,pack_id,resource_type,resource_key,resource_id,managed,created_by_pack,reattachable,state,baseline_json,last_error,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(pack_id,resource_type,resource_key) DO UPDATE SET
        resource_id=excluded.resource_id,
        managed=excluded.managed,
        created_by_pack=excluded.created_by_pack,
        reattachable=excluded.reattachable,
        state=excluded.state,
        baseline_json=excluded.baseline_json,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at`,
    ).run(
      id,
      input.packId,
      input.resourceType,
      input.resourceKey,
      input.resourceId,
      Number(input.managed),
      Number(input.createdByPack),
      Number(input.reattachable),
      input.state,
      JSON.stringify(input.baseline),
      input.lastError ?? null,
      current?.createdAt ?? timestamp,
      timestamp,
    );
    return this.getOperatorPackResource(
      input.packId,
      input.resourceType,
      input.resourceKey,
    )!;
  },
  detachOperatorPackResources(packId: string) {
    return db
      .prepare(
        "UPDATE operator_pack_resources SET reattachable=managed,managed=0,state='detached',updated_at=? WHERE pack_id=?",
      )
      .run(now(), packId).changes;
  },

  listOperatorPackAcceptances(packId?: string) {
    const rows = packId
      ? db
          .prepare(
            "SELECT * FROM operator_pack_acceptance_runs WHERE pack_id=? ORDER BY created_at DESC",
          )
          .all(packId)
      : db
          .prepare(
            "SELECT * FROM operator_pack_acceptance_runs ORDER BY created_at DESC",
          )
          .all();
    return (rows as Row[]).map(mapOperatorPackAcceptance);
  },
  getOperatorPackAcceptance(id: string) {
    const row = db
      .prepare("SELECT * FROM operator_pack_acceptance_runs WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapOperatorPackAcceptance(row) : null;
  },
  createOperatorPackAcceptance(input: {
    packId: string;
    scenarioId: string;
    packVersion: string;
    rubric: Record<string, unknown>;
  }) {
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO operator_pack_acceptance_runs
        (id,pack_id,scenario_id,pack_version,status,rubric_json,evidence_json,created_at,updated_at)
       VALUES (?,?,?,?,'preparing',?,'{}',?,?)`,
    ).run(
      id,
      input.packId,
      input.scenarioId,
      input.packVersion,
      JSON.stringify(input.rubric),
      timestamp,
      timestamp,
    );
    return this.getOperatorPackAcceptance(id)!;
  },
  updateOperatorPackAcceptance(
    id: string,
    input: Partial<{
      runId: string | null;
      projectKey: string | null;
      issueKey: string | null;
      docId: string | null;
      status: OperatorPackAcceptanceStatus;
      evidence: Record<string, unknown>;
      error: string | null;
      completedAt: string | null;
    }>,
  ) {
    const current = this.getOperatorPackAcceptance(id);
    if (!current) return null;
    db.prepare(
      `UPDATE operator_pack_acceptance_runs SET
        run_id=?,project_key=?,issue_key=?,doc_id=?,status=?,evidence_json=?,error=?,completed_at=?,updated_at=?
       WHERE id=?`,
    ).run(
      input.runId === undefined ? current.runId : input.runId,
      input.projectKey === undefined ? current.projectKey : input.projectKey,
      input.issueKey === undefined ? current.issueKey : input.issueKey,
      input.docId === undefined ? current.docId : input.docId,
      input.status ?? current.status,
      JSON.stringify(input.evidence ?? current.evidence),
      input.error === undefined ? current.error : input.error,
      input.completedAt === undefined ? current.completedAt : input.completedAt,
      now(),
      id,
    );
    return this.getOperatorPackAcceptance(id);
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
    expectedVersion: number,
  ) {
    const timestamp = now();
    const transaction = db.transaction(() => {
      const revision = db
        .prepare(
          "UPDATE integrations SET version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .run(timestamp, integrationId, expectedVersion);
      if (revision.changes !== 1) throw new IntegrationVersionConflictError();
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
    const records = this.listIntegrationRecords();
    const permissions = (
      db
        .prepare(
          "SELECT integration_id,agent_id,tool_key FROM agent_integration_tools ORDER BY integration_id,agent_id,tool_key",
        )
        .all() as Array<{
        integration_id: string;
        agent_id: string;
        tool_key: string;
      }>
    ).reduce<Record<string, Record<string, string[]>>>((result, row) => {
      const integration = (result[row.integration_id] ??= {});
      (integration[row.agent_id] ??= []).push(row.tool_key);
      return result;
    }, {});
    const operations = (
      db
        .prepare(
          "SELECT * FROM custom_http_operations ORDER BY integration_id,key",
        )
        .all() as Row[]
    ).reduce<Record<string, IntegrationHttpOperation[]>>((result, row) => {
      (result[String(row.integration_id)] ??= []).push(
        mapCustomHttpOperation(row),
      );
      return result;
    }, {});
    const mcpTools = (
      db
        .prepare("SELECT * FROM custom_mcp_tools ORDER BY integration_id,name")
        .all() as Row[]
    ).reduce<Record<string, IntegrationMcpTool[]>>((result, row) => {
      (result[String(row.integration_id)] ??= []).push(mapCustomMcpTool(row));
      return result;
    }, {});

    return records.map((record) =>
      mapIntegration(
        record,
        permissions[record.id] ?? {},
        operations[record.id] ?? [],
        mcpTools[record.id] ?? [],
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
    expectedAbsent?: boolean;
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
      if (
        input.expectedAbsent &&
        this.getIntegrationRecordByProvider(input.provider)
      ) {
        throw new IntegrationVersionConflictError(
          "Integration was created by another request. Reload and try again.",
        );
      }
      if (input.expectedVersion !== undefined) {
        const live = this.getIntegrationRecord(id);
        if (!live || live.version !== input.expectedVersion) {
          throw new IntegrationVersionConflictError();
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
        current?.slug ?? normalizeIntegrationSlug(input.name),
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
  deleteIntegration(id: string, expectedVersion: number) {
    const result = db
      .prepare("DELETE FROM integrations WHERE id=? AND version=?")
      .run(id, expectedVersion);
    if (result.changes !== 1) throw new IntegrationVersionConflictError();
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

  listRuntimeConfigs() {
    return (
      db
        .prepare("SELECT * FROM runtime_configs ORDER BY runtime_id")
        .all() as Row[]
    ).map(mapRuntimeConfig);
  },
  getRuntimeConfig(runtimeId: string) {
    const row = db
      .prepare("SELECT * FROM runtime_configs WHERE runtime_id=?")
      .get(runtimeId) as Row | undefined;
    return row ? mapRuntimeConfig(row) : null;
  },
  saveRuntimeConfig(input: {
    runtimeId: string;
    enabled: boolean;
    authMode: RuntimeConfigRecord["authMode"];
    credentialCiphertext?: string | null;
    baseUrl?: string | null;
    apiFormat?: RuntimeConfigRecord["apiFormat"];
    defaultModel: string;
    models: string[];
    lastVerificationStatus?: RuntimeConfigRecord["lastVerificationStatus"];
    lastVerificationDetail?: string | null;
    lastVerifiedAt?: string | null;
  }) {
    const current = this.getRuntimeConfig(input.runtimeId);
    const timestamp = now();
    db.prepare(
      `INSERT INTO runtime_configs
        (runtime_id,enabled,auth_mode,credential_ciphertext,base_url,api_format,default_model,models_json,config_version,last_verification_status,last_verification_detail,last_verified_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(runtime_id) DO UPDATE SET
        enabled=excluded.enabled,
        auth_mode=excluded.auth_mode,
        credential_ciphertext=excluded.credential_ciphertext,
        base_url=excluded.base_url,
        api_format=excluded.api_format,
        default_model=excluded.default_model,
        models_json=excluded.models_json,
        config_version=excluded.config_version,
        last_verification_status=excluded.last_verification_status,
        last_verification_detail=excluded.last_verification_detail,
        last_verified_at=excluded.last_verified_at,
        updated_at=excluded.updated_at`,
    ).run(
      input.runtimeId,
      input.enabled ? 1 : 0,
      input.authMode,
      input.credentialCiphertext ?? current?.credentialCiphertext ?? null,
      input.baseUrl ?? current?.baseUrl ?? null,
      input.apiFormat ?? current?.apiFormat ?? null,
      input.defaultModel,
      JSON.stringify([...new Set(input.models)]),
      current ? current.configVersion + 1 : 1,
      "lastVerificationStatus" in input
        ? input.lastVerificationStatus
        : (current?.lastVerificationStatus ?? null),
      "lastVerificationDetail" in input
        ? input.lastVerificationDetail
        : (current?.lastVerificationDetail ?? null),
      "lastVerifiedAt" in input
        ? input.lastVerifiedAt
        : (current?.lastVerifiedAt ?? null),
      current?.createdAt ?? timestamp,
      timestamp,
    );
    return this.getRuntimeConfig(input.runtimeId)!;
  },

  completeRuntimeVerification(input: {
    runtimeId: string;
    expectedConfigVersion: number;
    status: NonNullable<RuntimeConfigRecord["lastVerificationStatus"]>;
    detail: string;
    checkedAt: string;
    models?: string[];
    defaultModel?: string;
  }) {
    const result = input.models
      ? db
          .prepare(
            `UPDATE runtime_configs
           SET models_json=?, default_model=?, config_version=config_version+1,
               last_verification_status=?, last_verification_detail=?,
               last_verified_at=?, updated_at=?
           WHERE runtime_id=? AND config_version=?`,
          )
          .run(
            JSON.stringify([...new Set(input.models)]),
            input.defaultModel ?? "default",
            input.status,
            input.detail,
            input.checkedAt,
            now(),
            input.runtimeId,
            input.expectedConfigVersion,
          )
      : db
          .prepare(
            `UPDATE runtime_configs
           SET config_version=config_version+1,
               last_verification_status=?, last_verification_detail=?,
               last_verified_at=?, updated_at=?
           WHERE runtime_id=? AND config_version=?`,
          )
          .run(
            input.status,
            input.detail,
            input.checkedAt,
            now(),
            input.runtimeId,
            input.expectedConfigVersion,
          );
    return result.changes === 1;
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
    > & { runtime?: string },
  ) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO agents (id,name,slug,role,instructions,runtime,model,enabled,full_access,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.slug,
      input.role,
      input.instructions,
      input.runtime ?? "codex",
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
  getAgentQuickActionByLabel(agentId: string, label: string) {
    const row = db
      .prepare("SELECT * FROM agent_quick_actions WHERE agent_id=? AND label=?")
      .get(agentId, label) as Row | undefined;
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
        | "name"
        | "slug"
        | "role"
        | "instructions"
        | "runtime"
        | "model"
        | "enabled"
        | "fullAccess"
      >
    >,
  ) {
    const current = this.getAgent(id);
    if (!current) return null;
    db.prepare(
      "UPDATE agents SET name=?, slug=?, role=?, instructions=?, runtime=?, model=?, enabled=?, full_access=?, updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.slug ?? current.slug,
      input.role ?? current.role,
      input.instructions ?? current.instructions,
      input.runtime ?? current.runtime,
      input.model ?? current.model,
      (input.enabled ?? current.enabled) ? 1 : 0,
      (input.fullAccess ?? current.fullAccess) ? 1 : 0,
      now(),
      current.id,
    );
    return this.getAgent(current.id);
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
  setRuntimeThread(
    id: string,
    runtimeThreadId: string | null,
    runtime: string | null = null,
  ) {
    db.prepare(
      "UPDATE threads SET runtime_thread_id=?, runtime=?, updated_at=? WHERE id=?",
    ).run(runtimeThreadId, runtimeThreadId ? runtime : null, now(), id);
  },
  touchThread(id: string) {
    db.prepare("UPDATE threads SET updated_at=? WHERE id=?").run(now(), id);
  },
  listMessages(threadId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM messages WHERE thread_id=? ORDER BY created_at,rowid",
        )
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
  addRunMessageOnce(
    threadId: string,
    runId: string,
    role: Message["role"],
    body: string,
  ) {
    const insert = db.transaction(() => {
      const existing = db
        .prepare(
          "SELECT * FROM messages WHERE run_id=? AND role=? ORDER BY rowid LIMIT 1",
        )
        .get(runId, role) as Row | undefined;
      if (existing) return mapMessage(existing);
      const id = randomUUID();
      db.prepare(
        "INSERT INTO messages (id,thread_id,run_id,role,body,created_at) VALUES (?,?,?,?,?,?)",
      ).run(id, threadId, runId, role, body, now());
      this.touchThread(threadId);
      return mapMessage(
        db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Row,
      );
    });
    return insert.immediate();
  },

  createRun(input: {
    id?: string;
    agentId: string;
    threadId?: string | null;
    automationId?: string | null;
    runtime?: string;
    model?: string;
    trigger: Run["trigger"];
    mode: Run["mode"];
    issueKey?: string | null;
    runInstructions: string;
  }) {
    const id = input.id ?? randomUUID();
    const createdAt = now();
    db.prepare(
      "INSERT INTO runs (id,agent_id,thread_id,automation_id,status,runtime,model,trigger,mode,issue_key,run_instructions,created_at,queued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.agentId,
      input.threadId ?? null,
      input.automationId ?? null,
      "queued",
      input.runtime ?? "codex",
      input.model ?? "default",
      input.trigger,
      input.mode,
      input.issueKey ?? null,
      input.runInstructions,
      createdAt,
      createdAt,
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
          `SELECT * FROM runs
           WHERE status IN ('queued','running','waiting_approval')
              OR id IN (
                SELECT id FROM runs
                ORDER BY COALESCE(started_at,'') DESC,rowid DESC
                LIMIT ?
              )
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'waiting_approval' THEN 1
               WHEN 'queued' THEN 2
               ELSE 3
             END,
             CASE WHEN status='queued' THEN queued_at END ASC,
             COALESCE(started_at,created_at) DESC,rowid DESC`,
        )
        .all(limit) as Row[]
    ).map(mapRun);
  },
  listAgentActivityRuns() {
    return (
      db
        .prepare(
          `SELECT * FROM runs
           WHERE status IN ('queued','running','waiting_approval')
              OR rowid IN (SELECT MAX(rowid) FROM runs GROUP BY agent_id)
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'waiting_approval' THEN 1
               WHEN 'queued' THEN 2
               ELSE 3
             END,
             CASE WHEN status='queued' THEN queued_at END ASC,
             COALESCE(started_at,created_at) DESC,rowid DESC`,
        )
        .all() as Row[]
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
  updateRunRunnerCursor(
    id: string,
    leaseOwner: string,
    runnerRunId: string,
    runnerEventId: number,
    reset = false,
  ) {
    const comparison = reset
      ? ""
      : "AND runner_run_id=? AND runner_event_id < ?";
    const parameters = reset
      ? [runnerRunId, runnerEventId, id, leaseOwner]
      : [
          runnerRunId,
          runnerEventId,
          id,
          leaseOwner,
          runnerRunId,
          runnerEventId,
        ];
    return db
      .prepare(
        `UPDATE runs SET runner_run_id=?,runner_event_id=?
         WHERE id=? AND lease_owner=? ${comparison}`,
      )
      .run(...parameters).changes;
  },
  ownsRunLease(id: string, leaseOwner: string) {
    const row = db
      .prepare(
        `SELECT 1 AS owned FROM runs
         WHERE id=? AND lease_owner=? AND lease_expires_at > ?`,
      )
      .get(id, leaseOwner, now()) as { owned: number } | undefined;
    return row?.owned === 1;
  },
  requeueRunForRunnerReconnect(id: string, leaseOwner: string, error: string) {
    const attemptCount = this.getRun(id)?.attemptCount ?? 1;
    const retryAt = new Date(
      Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount - 1, 6)),
    ).toISOString();
    return db
      .prepare(
        `UPDATE runs
         SET status='queued',started_at=NULL,completed_at=NULL,error=?,runner_retry_at=?
         WHERE id=? AND lease_owner=? AND lease_expires_at > ?`,
      )
      .run(error, retryAt, id, leaseOwner, now()).changes;
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
        .prepare(
          "SELECT * FROM run_events WHERE run_id=? ORDER BY created_at,rowid",
        )
        .all(runId) as Row[]
    ).map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      type: String(row.type),
      payload: telemetryJson(row.payload, {}),
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
      lastScheduledFor: string | null;
      missedRunPolicy: Automation["missedRunPolicy"];
    }>,
  ) {
    const current = this.getAutomation(id);
    if (!current) return null;
    db.prepare(
      "UPDATE automations SET name=?,cron_expression=?,prompt=?,mode=?,enabled=?,last_run_at=?,last_scheduled_for=?,missed_run_policy=?,updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.cronExpression === undefined
        ? current.cronExpression
        : input.cronExpression,
      input.prompt ?? current.prompt,
      input.mode ?? current.mode,
      (input.enabled ?? current.enabled) ? 1 : 0,
      input.lastRunAt === undefined ? current.lastRunAt : input.lastRunAt,
      input.lastScheduledFor === undefined
        ? current.lastScheduledFor
        : input.lastScheduledFor,
      input.missedRunPolicy ?? current.missedRunPolicy,
      now(),
      id,
    );
    return this.getAutomation(id);
  },
  claimAutomationOccurrence(automationId: string, scheduledFor: string) {
    const runId = randomUUID();
    const createdAt = now();
    db.prepare(
      `INSERT OR IGNORE INTO automation_occurrences
       (automation_id,scheduled_for,run_id,status,created_at)
       VALUES (?,?,?,'pending',?)`,
    ).run(automationId, scheduledFor, runId, createdAt);
    return db
      .prepare(
        `SELECT automation_id AS automationId,scheduled_for AS scheduledFor,
                run_id AS runId,status,created_at AS createdAt,
                dispatched_at AS dispatchedAt
         FROM automation_occurrences
         WHERE automation_id=? AND scheduled_for=?`,
      )
      .get(automationId, scheduledFor) as {
      automationId: string;
      scheduledFor: string;
      runId: string;
      status: "pending" | "dispatched";
      createdAt: string;
      dispatchedAt: string | null;
    };
  },
  listPendingAutomationOccurrences(limit = 100) {
    return db
      .prepare(
        `SELECT automation_id AS automationId,scheduled_for AS scheduledFor,
                run_id AS runId,status,created_at AS createdAt,
                dispatched_at AS dispatchedAt
         FROM automation_occurrences
         WHERE status='pending'
         ORDER BY created_at,automation_id
         LIMIT ?`,
      )
      .all(limit) as Array<{
      automationId: string;
      scheduledFor: string;
      runId: string;
      status: "pending";
      createdAt: string;
      dispatchedAt: null;
    }>;
  },
  markAutomationOccurrenceDispatched(
    automationId: string,
    scheduledFor: string,
    runId: string,
  ) {
    return db
      .prepare(
        `UPDATE automation_occurrences
         SET status='dispatched',dispatched_at=?
         WHERE automation_id=? AND scheduled_for=? AND run_id=? AND status='pending'`,
      )
      .run(now(), automationId, scheduledFor, runId).changes;
  },
};
