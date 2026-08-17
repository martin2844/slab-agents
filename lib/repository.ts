import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";
import type {
  Agent,
  AgentQuickAction,
  Approval,
  Automation,
  Integration,
  IntegrationProvider,
  IntegrationStatus,
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
    enabled: bool(row.enabled),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
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
  config: { datacenter: "us" | "eu" };
  credentialsCiphertext: string;
  status: IntegrationStatus;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapIntegrationRecord(row: Row): IntegrationRecord {
  const config = json(row.config_json, { datacenter: "us" as const });
  return {
    id: String(row.id),
    provider: row.provider as IntegrationProvider,
    name: String(row.name),
    config,
    credentialsCiphertext: String(row.credentials_ciphertext),
    status: row.status as IntegrationStatus,
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapIntegration(
  record: IntegrationRecord,
  permissions: Record<string, string[]>,
): Integration {
  return {
    id: record.id,
    provider: record.provider,
    name: record.name,
    datacenter: record.config.datacenter,
    status: record.status,
    hasApiKey: Boolean(record.credentialsCiphertext),
    lastTestedAt: record.lastTestedAt,
    lastError: record.lastError,
    permissions,
    tools: record.provider === "posthog" ? POSTHOG_TOOLS : [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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
  setSetting(key: string, value: string) {
    db.prepare(
      "INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    ).run(key, value, now());
  },

  listIntegrationRecords() {
    return (
      db.prepare("SELECT * FROM integrations ORDER BY name").all() as Row[]
    ).map(mapIntegrationRecord);
  },
  getIntegrationRecord(idOrProvider: string) {
    const row = db
      .prepare("SELECT * FROM integrations WHERE id=? OR provider=?")
      .get(idOrProvider, idOrProvider) as Row | undefined;
    return row ? mapIntegrationRecord(row) : null;
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
  listIntegrations() {
    return this.listIntegrationRecords().map((record) =>
      mapIntegration(record, this.listIntegrationPermissions(record.id)),
    );
  },
  getIntegration(idOrProvider: string) {
    const record = this.getIntegrationRecord(idOrProvider);
    return record
      ? mapIntegration(record, this.listIntegrationPermissions(record.id))
      : null;
  },
  saveIntegration(input: {
    id?: string;
    provider: IntegrationProvider;
    name: string;
    datacenter: "us" | "eu";
    credentialsCiphertext: string;
    status: IntegrationStatus;
    lastTestedAt: string | null;
    lastError: string | null;
    permissions: Record<string, string[]>;
  }) {
    const current = this.getIntegrationRecord(input.id ?? input.provider);
    const id = current?.id ?? input.id ?? randomUUID();
    const timestamp = now();
    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO integrations
          (id,provider,name,config_json,credentials_ciphertext,status,last_tested_at,last_error,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(provider) DO UPDATE SET
          name=excluded.name,
          config_json=excluded.config_json,
          credentials_ciphertext=excluded.credentials_ciphertext,
          status=excluded.status,
          last_tested_at=excluded.last_tested_at,
          last_error=excluded.last_error,
          updated_at=excluded.updated_at`,
      ).run(
        id,
        input.provider,
        input.name,
        JSON.stringify({ datacenter: input.datacenter }),
        input.credentialsCiphertext,
        input.status,
        input.lastTestedAt,
        input.lastError,
        current?.createdAt ?? timestamp,
        timestamp,
      );
      const saved = this.getIntegrationRecord(input.provider);
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
  }) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO runs (id,agent_id,thread_id,automation_id,status,runtime) VALUES (?,?,?,?,?,?)",
    ).run(
      id,
      input.agentId,
      input.threadId ?? null,
      input.automationId ?? null,
      "queued",
      input.runtime ?? "codex",
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
    const completed = ["completed", "failed", "cancelled"].includes(status)
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
          "SELECT a.*, g.name agent_name FROM automations a JOIN agents g ON g.id=a.agent_id ORDER BY a.enabled DESC,a.name",
        )
        .all() as Row[]
    ).map(mapAutomation);
  },
  getAutomation(id: string) {
    const row = db
      .prepare(
        "SELECT a.*, g.name agent_name FROM automations a JOIN agents g ON g.id=a.agent_id WHERE a.id=?",
      )
      .get(id) as Row | undefined;
    return row ? mapAutomation(row) : null;
  },
  createAutomation(input: {
    name: string;
    agentId: string;
    cronExpression: string | null;
    prompt: string;
    enabled: boolean;
  }) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO automations (id,name,agent_id,cron_expression,prompt,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.agentId,
      input.cronExpression,
      input.prompt,
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
      enabled: boolean;
      lastRunAt: string | null;
    }>,
  ) {
    const current = this.getAutomation(id);
    if (!current) return null;
    db.prepare(
      "UPDATE automations SET name=?,cron_expression=?,prompt=?,enabled=?,last_run_at=?,updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.cronExpression === undefined
        ? current.cronExpression
        : input.cronExpression,
      input.prompt ?? current.prompt,
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
