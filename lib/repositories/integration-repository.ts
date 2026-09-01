import "server-only";

import { randomUUID } from "node:crypto";
import { IntegrationVersionConflictError } from "@/lib/integrations/errors";
import { normalizeIntegrationSlug } from "@/lib/integrations/naming";
import { db, now } from "@/lib/db/database";
import type {
  IntegrationHttpOperation,
  IntegrationMcpTool,
  IntegrationProvider,
  IntegrationStatus,
} from "@/lib/types";
import {
  mapCustomHttpOperation,
  mapCustomMcpTool,
  mapIntegration,
  mapIntegrationRecord,
  mapRunIntegrationCapability,
  type IntegrationRecord,
} from "@/lib/repositories/integration-records";
import { bool, json, type Row } from "@/lib/repositories/repository-helpers";

export type { IntegrationRecord } from "@/lib/repositories/integration-records";

export const integrationRepository = {
  createIntegrationOAuthState(input: {
    id: string;
    integrationId: string;
    provider: IntegrationProvider;
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
  getIntegrationOAuthStateProvider(id: string) {
    const row = db
      .prepare("SELECT provider FROM integration_oauth_states WHERE id=?")
      .get(id) as { provider?: IntegrationProvider } | undefined;
    return row?.provider ?? null;
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
      provider: row.provider as IntegrationProvider,
      verifierCiphertext: String(row.verifier_ciphertext),
      redirectUri: String(row.redirect_uri),
      expiresAt: String(row.expires_at),
      integrationVersion: Number(row.integration_version ?? 1),
    };
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
    return integrationRepository.getIntegration(integrationId);
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
    const records = integrationRepository.listIntegrationRecords();
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
      integrationRepository.getIntegrationRecord(idOrProvider) ??
      integrationRepository.getIntegrationRecordByProvider(
        idOrProvider as IntegrationProvider,
      ) ??
      null;
    return record
      ? mapIntegration(
          record,
          integrationRepository.listIntegrationPermissions(record.id),
          record.provider === "custom_http"
            ? integrationRepository.listCustomHttpOperations(record.id)
            : [],
          record.provider === "custom_mcp"
            ? integrationRepository.listCustomMcpTools(record.id)
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
      ? integrationRepository.getIntegrationRecord(input.id)
      : input.provider === "posthog"
        ? integrationRepository.getIntegrationRecordByProvider(input.provider)
        : null;
    const id = current?.id ?? input.id ?? randomUUID();
    const timestamp = now();
    const enabled = input.enabled ?? true;
    const operations =
      input.operations ??
      (input.provider === "custom_http"
        ? integrationRepository.listCustomHttpOperations(id)
        : []);
    const mcpTools =
      input.mcpTools ??
      (input.provider === "custom_mcp"
        ? integrationRepository.listCustomMcpTools(id)
        : []);
    const transaction = db.transaction(() => {
      if (
        input.expectedAbsent &&
        integrationRepository.getIntegrationRecordByProvider(input.provider)
      ) {
        throw new IntegrationVersionConflictError(
          "Integration was created by another request. Reload and try again.",
        );
      }
      if (input.expectedVersion !== undefined) {
        const live = integrationRepository.getIntegrationRecord(id);
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
      const saved = integrationRepository.getIntegrationRecord(id);
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
    return integrationRepository.getIntegration(transaction())!;
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
    return result.changes === 1
      ? integrationRepository.getIntegration(id)
      : null;
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
    return integrationRepository.getIntegrationRecord(id);
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
  completeGoogleDataOAuth(input: {
    id: string;
    provider: "google_analytics" | "google_search_console";
    expectedVersion: number;
    credentialsCiphertext: string;
    accountEmail?: string;
    testedAt: string;
  }) {
    const transaction = db.transaction(() => {
      const current = db
        .prepare(
          "SELECT * FROM integrations WHERE id=? AND provider=? AND version=?",
        )
        .get(input.id, input.provider, input.expectedVersion) as Row | undefined;
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
            accountName: input.accountEmail ?? null,
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
    const current = integrationRepository.getRunIntegrationCapability(
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
    return integrationRepository.getRunIntegrationCapability(
      input.runId,
      input.integrationId,
    )!;
  },
};
