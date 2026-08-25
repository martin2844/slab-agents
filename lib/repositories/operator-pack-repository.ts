import "server-only";

import { randomUUID } from "node:crypto";
import type { OperatorPackManifest } from "@/lib/packs/manifest";
import { db, now } from "@/lib/db/database";
import { json, type Row } from "@/lib/repositories/repository-helpers";
import type {
  OperatorPackAcceptance,
  OperatorPackAcceptanceStatus,
  OperatorPackInstallation,
  OperatorPackInstallationStatus,
  OperatorPackResource,
  OperatorPackResourceType,
} from "@/lib/types";

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
    managed: Boolean(row.managed),
    createdByPack: Boolean(row.created_by_pack),
    reattachable: Boolean(row.reattachable),
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

export const operatorPackRepository = {
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
    const current = operatorPackRepository.getOperatorPackDefinition(
      manifest.id,
    );
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
    return operatorPackRepository.getOperatorPackDefinition(manifest.id)!;
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
    const current = operatorPackRepository.getOperatorPackInstallation(
      input.packId,
    );
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
    return operatorPackRepository.getOperatorPackInstallation(input.packId)!;
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
    const current = operatorPackRepository.getOperatorPackResource(
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
    return operatorPackRepository.getOperatorPackResource(
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
    return operatorPackRepository.getOperatorPackAcceptance(id)!;
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
    const current = operatorPackRepository.getOperatorPackAcceptance(id);
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
    return operatorPackRepository.getOperatorPackAcceptance(id);
  },
};
