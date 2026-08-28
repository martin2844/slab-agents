import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import type {
  GitHubSourceApp,
  KnowledgeSource,
  KnowledgeSourceConfig,
  KnowledgeSourceStatus,
} from "@/lib/types";

export type KnowledgeSourceRecord = Omit<
  KnowledgeSource,
  "secretConfigured"
> & {
  credentialsCiphertext: string;
  syncId: string | null;
  syncHeartbeatAt: string | null;
};

export type KnowledgeSourceItemRecord = {
  id: string;
  sourceId: string;
  externalId: string;
  documentId: string;
  canonicalUrl: string | null;
  contentHash: string;
  remoteUpdatedAt: string | null;
  lastSeenSyncId: string;
  createdAt: string;
  updatedAt: string;
};

type GitHubSourceAppRecord = GitHubSourceApp & {
  privateKeyCiphertext: string | null;
};

function mapSource(row: Row): KnowledgeSourceRecord {
  let config: KnowledgeSourceConfig;
  try {
    const parsed = JSON.parse(String(row.config_json)) as KnowledgeSourceConfig;
    if (!parsed || parsed.kind !== row.kind) throw new Error("kind mismatch");
    config = parsed;
  } catch {
    throw new Error(
      `Stored configuration for source ${String(row.id)} is invalid.`,
    );
  }
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    kind: row.kind as KnowledgeSourceRecord["kind"],
    config,
    authType: config.authType,
    credentialsCiphertext: String(row.credentials_ciphertext),
    githubAppId: row.github_app_id ? String(row.github_app_id) : null,
    enabled: bool(row.enabled),
    version: Number(row.version),
    syncIntervalMinutes:
      row.sync_interval_minutes === null ||
      row.sync_interval_minutes === undefined
        ? null
        : Number(row.sync_interval_minutes),
    status: row.status as KnowledgeSourceStatus,
    lastSyncStartedAt: row.last_sync_started_at
      ? String(row.last_sync_started_at)
      : null,
    syncId: row.sync_id ? String(row.sync_id) : null,
    syncHeartbeatAt: row.sync_heartbeat_at
      ? String(row.sync_heartbeat_at)
      : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    rootDocumentId: row.root_document_id ? String(row.root_document_id) : null,
    itemCount: Number(row.item_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapItem(row: Row): KnowledgeSourceItemRecord {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    externalId: String(row.external_id),
    documentId: String(row.document_id),
    canonicalUrl: row.canonical_url ? String(row.canonical_url) : null,
    contentHash: String(row.content_hash),
    remoteUpdatedAt: row.remote_updated_at
      ? String(row.remote_updated_at)
      : null,
    lastSeenSyncId: String(row.last_seen_sync_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapGithubApp(row: Row): GitHubSourceAppRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    organization: row.organization ? String(row.organization) : null,
    appId: row.app_id ? String(row.app_id) : null,
    appSlug: row.app_slug ? String(row.app_slug) : null,
    privateKeyCiphertext: row.private_key_ciphertext
      ? String(row.private_key_ciphertext)
      : null,
    installationId: row.installation_id ? String(row.installation_id) : null,
    accountLogin: row.account_login ? String(row.account_login) : null,
    status: row.status as GitHubSourceApp["status"],
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const sourceRepository = {
  listSources() {
    return (
      db.prepare("SELECT * FROM knowledge_sources ORDER BY name").all() as Row[]
    ).map(mapSource);
  },
  getSource(id: string) {
    const row = db
      .prepare("SELECT * FROM knowledge_sources WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapSource(row) : null;
  },
  getSourceBySlug(slug: string) {
    const row = db
      .prepare("SELECT * FROM knowledge_sources WHERE slug=?")
      .get(slug) as Row | undefined;
    return row ? mapSource(row) : null;
  },
  createSource(input: {
    name: string;
    slug: string;
    kind: KnowledgeSourceRecord["kind"];
    config: KnowledgeSourceConfig;
    credentialsCiphertext: string;
    githubAppId: string | null;
    enabled: boolean;
    syncIntervalMinutes: number | null;
  }) {
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO knowledge_sources
        (id,name,slug,kind,config_json,credentials_ciphertext,github_app_id,enabled,version,sync_interval_minutes,status,item_count,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,0,?,?)`,
    ).run(
      id,
      input.name,
      input.slug,
      input.kind,
      JSON.stringify(input.config),
      input.credentialsCiphertext,
      input.githubAppId,
      Number(input.enabled),
      input.syncIntervalMinutes,
      input.enabled ? "never_synced" : "disabled",
      timestamp,
      timestamp,
    );
    return sourceRepository.getSource(id)!;
  },
  updateSource(input: {
    id: string;
    expectedVersion: number;
    name: string;
    config: KnowledgeSourceConfig;
    credentialsCiphertext: string;
    githubAppId: string | null;
    enabled: boolean;
    syncIntervalMinutes: number | null;
  }) {
    const status = input.enabled ? "never_synced" : "disabled";
    const result = db
      .prepare(
        `UPDATE knowledge_sources
         SET name=?,config_json=?,credentials_ciphertext=?,github_app_id=?,enabled=?,
             sync_interval_minutes=?,status=?,last_error=NULL,version=version+1,updated_at=?
         WHERE id=? AND version=? AND status NOT IN ('syncing','deleting')`,
      )
      .run(
        input.name,
        JSON.stringify(input.config),
        input.credentialsCiphertext,
        input.githubAppId,
        Number(input.enabled),
        input.syncIntervalMinutes,
        status,
        now(),
        input.id,
        input.expectedVersion,
      );
    return result.changes === 1 ? sourceRepository.getSource(input.id) : null;
  },
  beginDelete(id: string, expectedVersion: number) {
    const current = sourceRepository.getSource(id);
    if (current?.status === "deleting" && current.version === expectedVersion) {
      return current;
    }
    const result = db
      .prepare(
        `UPDATE knowledge_sources
         SET status='deleting',enabled=0,version=version+1,last_error=NULL,updated_at=?
         WHERE id=? AND version=? AND status NOT IN ('syncing','deleting')`,
      )
      .run(now(), id, expectedVersion);
    return result.changes === 1 ? sourceRepository.getSource(id) : null;
  },
  failDelete(id: string, expectedVersion: number, message: string) {
    db.prepare(
      `UPDATE knowledge_sources SET last_error=?,updated_at=?
       WHERE id=? AND version=? AND status='deleting'`,
    ).run(message.slice(0, 500), now(), id, expectedVersion);
  },
  finishDelete(id: string, expectedVersion: number) {
    return (
      db
        .prepare(
          "DELETE FROM knowledge_sources WHERE id=? AND version=? AND status='deleting'",
        )
        .run(id, expectedVersion).changes === 1
    );
  },
  listDueSourceIds(timestamp: string, limit = 4) {
    return (
      db
        .prepare(
          `SELECT id FROM knowledge_sources
           WHERE enabled=1 AND sync_interval_minutes IS NOT NULL
             AND (
               (
                 status='syncing' AND
                 datetime(COALESCE(sync_heartbeat_at,last_sync_started_at)) <= datetime(?, '-15 minutes')
               ) OR (
                 status<>'syncing' AND
                 datetime(
                   MAX(
                     COALESCE(last_synced_at,created_at),
                     COALESCE(last_sync_started_at,created_at)
                   ),
                   '+' || sync_interval_minutes || ' minutes'
                 ) <= datetime(?)
               )
             )
           ORDER BY MAX(
             COALESCE(last_synced_at,created_at),
             COALESCE(last_sync_started_at,created_at)
           ) ASC
           LIMIT ?`,
        )
        .all(timestamp, timestamp, limit) as Array<{ id: string }>
    ).map(({ id }) => id);
  },
  beginSync(id: string, startedAt: string, syncId: string) {
    const staleBefore = new Date(
      Date.parse(startedAt) - 15 * 60_000,
    ).toISOString();
    const result = db
      .prepare(
        `UPDATE knowledge_sources
         SET status='syncing',last_sync_started_at=?,sync_id=?,sync_heartbeat_at=?,
             last_error=NULL,updated_at=?
         WHERE id=? AND enabled=1
           AND (status<>'syncing' OR COALESCE(sync_heartbeat_at,last_sync_started_at)<?)`,
      )
      .run(startedAt, syncId, startedAt, startedAt, id, staleBefore);
    return result.changes === 1 ? sourceRepository.getSource(id) : null;
  },
  heartbeatSync(id: string, syncId: string) {
    return (
      db
        .prepare(
          `UPDATE knowledge_sources SET sync_heartbeat_at=?,updated_at=?
           WHERE id=? AND status='syncing' AND sync_id=?`,
        )
        .run(now(), now(), id, syncId).changes === 1
    );
  },
  ownsSync(id: string, syncId: string) {
    return Boolean(
      db
        .prepare(
          "SELECT 1 FROM knowledge_sources WHERE id=? AND status='syncing' AND sync_id=?",
        )
        .get(id, syncId),
    );
  },
  finishSync(input: {
    id: string;
    syncId: string;
    startedAt: string;
    rootDocumentId: string;
    itemCount: number;
    completedAt: string;
  }) {
    return (
      db
        .prepare(
          `UPDATE knowledge_sources
           SET status='healthy',root_document_id=?,item_count=?,last_synced_at=?,
               last_error=NULL,sync_id=NULL,sync_heartbeat_at=NULL,updated_at=?
           WHERE id=? AND status='syncing' AND last_sync_started_at=? AND sync_id=?`,
        )
        .run(
          input.rootDocumentId,
          input.itemCount,
          input.completedAt,
          input.completedAt,
          input.id,
          input.startedAt,
          input.syncId,
        ).changes === 1
    );
  },
  failSync(id: string, startedAt: string, syncId: string, message: string) {
    db.prepare(
      `UPDATE knowledge_sources
       SET status='error',last_error=?,sync_id=NULL,sync_heartbeat_at=NULL,updated_at=?
       WHERE id=? AND status='syncing' AND last_sync_started_at=? AND sync_id=?`,
    ).run(message.slice(0, 500), now(), id, startedAt, syncId);
  },
  setRootDocumentForSync(
    id: string,
    startedAt: string,
    syncId: string,
    rootDocumentId: string,
  ) {
    return (
      db
        .prepare(
          `UPDATE knowledge_sources SET root_document_id=?,updated_at=?
           WHERE id=? AND status='syncing' AND last_sync_started_at=? AND sync_id=?`,
        )
        .run(rootDocumentId, now(), id, startedAt, syncId).changes === 1
    );
  },
  listItems(sourceId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM knowledge_source_items WHERE source_id=? ORDER BY external_id",
        )
        .all(sourceId) as Row[]
    ).map(mapItem);
  },
  getItem(sourceId: string, externalId: string) {
    const row = db
      .prepare(
        "SELECT * FROM knowledge_source_items WHERE source_id=? AND external_id=?",
      )
      .get(sourceId, externalId) as Row | undefined;
    return row ? mapItem(row) : null;
  },
  saveItem(input: {
    sourceId: string;
    externalId: string;
    documentId: string;
    canonicalUrl: string | null;
    contentHash: string;
    remoteUpdatedAt: string | null;
    syncId: string;
  }) {
    const timestamp = now();
    const result = db
      .prepare(
        `INSERT INTO knowledge_source_items
        (id,source_id,external_id,document_id,canonical_url,content_hash,remote_updated_at,last_seen_sync_id,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?
       FROM knowledge_sources
       WHERE id=? AND status='syncing' AND sync_id=?
       ON CONFLICT(source_id,external_id) DO UPDATE SET
         document_id=excluded.document_id,
         canonical_url=excluded.canonical_url,
         content_hash=excluded.content_hash,
         remote_updated_at=excluded.remote_updated_at,
         last_seen_sync_id=excluded.last_seen_sync_id,
         updated_at=excluded.updated_at`,
      )
      .run(
        randomUUID(),
        input.sourceId,
        input.externalId,
        input.documentId,
        input.canonicalUrl,
        input.contentHash,
        input.remoteUpdatedAt,
        input.syncId,
        timestamp,
        timestamp,
        input.sourceId,
        input.syncId,
      );
    return result.changes === 1;
  },
  markItemSeen(sourceId: string, id: string, syncId: string) {
    return (
      db
        .prepare(
          `UPDATE knowledge_source_items SET last_seen_sync_id=?,updated_at=?
           WHERE id=? AND source_id=? AND EXISTS (
             SELECT 1 FROM knowledge_sources
             WHERE id=? AND status='syncing' AND sync_id=?
           )`,
        )
        .run(syncId, now(), id, sourceId, sourceId, syncId).changes === 1
    );
  },
  listUnseenItems(sourceId: string, syncId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM knowledge_source_items WHERE source_id=? AND last_seen_sync_id<>?",
        )
        .all(sourceId, syncId) as Row[]
    ).map(mapItem);
  },
  deleteItemForSync(sourceId: string, id: string, syncId: string) {
    return (
      db
        .prepare(
          `DELETE FROM knowledge_source_items
           WHERE id=? AND source_id=? AND EXISTS (
             SELECT 1 FROM knowledge_sources
             WHERE id=? AND status='syncing' AND sync_id=?
           )`,
        )
        .run(id, sourceId, sourceId, syncId).changes === 1
    );
  },
  listGithubApps() {
    return (
      db
        .prepare("SELECT * FROM github_source_apps ORDER BY name")
        .all() as Row[]
    ).map(mapGithubApp);
  },
  getGithubApp(id: string) {
    const row = db
      .prepare("SELECT * FROM github_source_apps WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapGithubApp(row) : null;
  },
  createGithubApp(name: string, organization: string | null) {
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO github_source_apps
        (id,name,organization,status,created_at,updated_at)
       VALUES (?,?,?,'pending_registration',?,?)`,
    ).run(id, name, organization, timestamp, timestamp);
    return sourceRepository.getGithubApp(id)!;
  },
  registerGithubApp(input: {
    id: string;
    appId: string;
    appSlug: string;
    privateKeyCiphertext: string;
  }) {
    const result = db
      .prepare(
        `UPDATE github_source_apps
       SET app_id=?,app_slug=?,private_key_ciphertext=?,status='pending_installation',
           last_error=NULL,updated_at=? WHERE id=? AND status='pending_registration'`,
      )
      .run(
        input.appId,
        input.appSlug,
        input.privateKeyCiphertext,
        now(),
        input.id,
      );
    return result.changes === 1
      ? sourceRepository.getGithubApp(input.id)
      : null;
  },
  installGithubApp(input: {
    id: string;
    installationId: string;
    accountLogin: string;
  }) {
    const timestamp = now();
    db.prepare(
      `UPDATE github_source_apps
       SET installation_id=?,account_login=?,status='connected',last_verified_at=?,
           last_error=NULL,updated_at=? WHERE id=? AND app_id IS NOT NULL`,
    ).run(
      input.installationId,
      input.accountLogin,
      timestamp,
      timestamp,
      input.id,
    );
    return sourceRepository.getGithubApp(input.id);
  },
  verifyGithubApp(
    id: string,
    status: "connected" | "error",
    error: string | null,
  ) {
    const timestamp = now();
    db.prepare(
      "UPDATE github_source_apps SET status=?,last_verified_at=?,last_error=?,updated_at=? WHERE id=?",
    ).run(status, timestamp, error?.slice(0, 500) ?? null, timestamp, id);
  },
  deleteGithubApp(id: string) {
    return (
      db.prepare("DELETE FROM github_source_apps WHERE id=?").run(id)
        .changes === 1
    );
  },
  saveGithubState(input: {
    stateHash: string;
    githubAppId: string;
    action: "manifest" | "install";
    expiresAt: string;
  }) {
    db.prepare(
      `INSERT INTO github_source_app_states
        (state_hash,github_app_id,action,expires_at,created_at)
       VALUES (?,?,?,?,?)`,
    ).run(
      input.stateHash,
      input.githubAppId,
      input.action,
      input.expiresAt,
      now(),
    );
  },
  consumeGithubState(stateHash: string, action: "manifest" | "install") {
    const transaction = db.transaction(() => {
      const row = db
        .prepare(
          "SELECT * FROM github_source_app_states WHERE state_hash=? AND action=?",
        )
        .get(stateHash, action) as Row | undefined;
      if (row) {
        db.prepare(
          "DELETE FROM github_source_app_states WHERE state_hash=?",
        ).run(stateHash);
      }
      db.prepare(
        "DELETE FROM github_source_app_states WHERE expires_at<=?",
      ).run(now());
      return row;
    });
    const row = transaction();
    if (!row || Date.parse(String(row.expires_at)) <= Date.now()) return null;
    return sourceRepository.getGithubApp(String(row.github_app_id));
  },
};
