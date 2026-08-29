import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { conflict, notFound, badRequest } from "@/lib/api";
import { DocsClient } from "@/lib/mcp/docs-client";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import {
  sourceRepository,
  type KnowledgeSourceRecord,
} from "@/lib/repositories/source-repository";
import {
  fetchKnowledgeSource,
  type FetchedSourceItem,
} from "@/lib/sources/connectors";
import { githubInstallationToken } from "@/lib/sources/github-app";
import { withSourceProvenance } from "@/lib/sources/source-content";
import type {
  KnowledgeSource,
  KnowledgeSourceConfig,
  SourcesPageData,
} from "@/lib/types";
import type { KnowledgeSourceInput } from "@/lib/api-schemas/source";
import { mapWithConcurrency } from "@/lib/async";
import { agentRepository } from "@/lib/repositories/agent-repository";

const AUTHOR = "Slab Sources";
const MAX_DOCUMENT_CHARACTERS = 1_900_000;

function slugify(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "source"
  );
}

function publicSource(source: KnowledgeSourceRecord): KnowledgeSource {
  const credentials = readCredentials(source.credentialsCiphertext);
  const safe = { ...source };
  delete (safe as Partial<KnowledgeSourceRecord>).credentialsCiphertext;
  delete (safe as Partial<KnowledgeSourceRecord>).syncId;
  delete (safe as Partial<KnowledgeSourceRecord>).syncHeartbeatAt;
  return { ...safe, secretConfigured: Boolean(credentials.secret) };
}

function readCredentials(ciphertext: string): { secret?: string } {
  try {
    const parsed = JSON.parse(decryptLocalSecret(ciphertext)) as {
      secret?: unknown;
    };
    return typeof parsed.secret === "string" && parsed.secret
      ? { secret: parsed.secret }
      : {};
  } catch {
    throw new Error("Stored source credentials are invalid.");
  }
}

function sourceConfig(input: KnowledgeSourceInput): KnowledgeSourceConfig {
  switch (input.kind) {
    case "wordpress":
      return {
        kind: input.kind,
        siteUrl: input.siteUrl,
        authType: input.authType,
        username: input.username,
        contentTypes: input.contentTypes,
        publishedOnly: input.publishedOnly,
        maxDocuments: input.maxDocuments,
      };
    case "github":
      return {
        kind: input.kind,
        repository: input.repository,
        branch: input.branch,
        authType: input.authType,
        pathPrefixes: input.pathPrefixes,
        extensions: input.extensions,
        maxDocuments: input.maxDocuments,
      };
    case "website":
      return {
        kind: input.kind,
        siteUrl: input.siteUrl,
        sitemapUrl: input.sitemapUrl,
        authType: input.authType,
        username: input.username,
        includePathPrefixes: input.includePathPrefixes,
        maxDocuments: input.maxDocuments,
      };
  }
}

function validateAuth(
  input: KnowledgeSourceInput,
  current?: KnowledgeSourceRecord,
) {
  if (input.kind === "github" && input.authType === "github_app") {
    if (!input.githubAppId) throw badRequest("Choose a connected GitHub App.");
    const app = sourceRepository.getGithubApp(input.githubAppId);
    if (!app || app.status !== "connected")
      throw badRequest("GitHub App is not connected.");
    return {};
  }
  const needsSecret = input.authType !== "none";
  const existing = current
    ? readCredentials(current.credentialsCiphertext)
    : {};
  const reusable = current
    ? credentialDestinationUnchanged(input, current)
    : false;
  if (needsSecret && !input.secret && (!existing.secret || !reusable)) {
    throw badRequest("Authentication secret is required.");
  }
  return { secret: input.secret || (reusable ? existing.secret : undefined) };
}

function credentialDestinationUnchanged(
  input: KnowledgeSourceInput,
  current: KnowledgeSourceRecord,
) {
  if (current.config.kind !== input.kind) return false;
  if (current.config.authType !== input.authType) return false;
  if (input.kind === "github" && current.config.kind === "github") return true;
  if (input.kind === "wordpress" && current.config.kind === "wordpress") {
    return (
      new URL(input.siteUrl).origin ===
        new URL(current.config.siteUrl).origin &&
      input.username === current.config.username
    );
  }
  if (input.kind === "website" && current.config.kind === "website") {
    return (
      new URL(input.siteUrl).origin ===
        new URL(current.config.siteUrl).origin &&
      input.username === current.config.username
    );
  }
  return false;
}

function uniqueSlug(name: string) {
  const base = slugify(name);
  let value = base;
  let suffix = 2;
  while (sourceRepository.getSourceBySlug(value)) value = `${base}-${suffix++}`;
  return value;
}

export function getSourcesPageData(): SourcesPageData {
  return {
    sources: listKnowledgeSources(),
    githubApps: sourceRepository.listGithubApps().map((record) => {
      const app = { ...record };
      delete (app as Partial<typeof record>).privateKeyCiphertext;
      return app;
    }),
    agents: agentRepository.listAgents().map(({ id, name, role, enabled }) => ({
      id,
      name,
      role,
      enabled,
    })),
  };
}

export function listKnowledgeSources(): KnowledgeSource[] {
  return sourceRepository.listSources().map(publicSource);
}

export function getKnowledgeSource(id: string) {
  const source = sourceRepository.getSource(id);
  if (!source) throw notFound("Source not found.");
  return publicSource(source);
}

export function saveKnowledgeSource(input: KnowledgeSourceInput) {
  const current = input.id ? sourceRepository.getSource(input.id) : null;
  if (input.id && !current) throw notFound("Source not found.");
  if (current && current.kind !== input.kind)
    throw badRequest("Source kind cannot be changed.");
  const credentials = validateAuth(input, current ?? undefined);
  const encrypted = encryptLocalSecret(JSON.stringify(credentials));
  const config = sourceConfig(input);
  const githubAppId =
    input.kind === "github" && input.authType === "github_app"
      ? input.githubAppId
      : null;
  const agentIds = input.agentIds ?? current?.agentIds ?? [];
  const knownAgentIds = new Set(
    agentRepository.listAgents().map((agent) => agent.id),
  );
  if (agentIds.some((agentId) => !knownAgentIds.has(agentId))) {
    throw badRequest("One or more selected agents no longer exist.");
  }

  if (!current) {
    return publicSource(
      sourceRepository.createSource({
        name: input.name,
        slug: uniqueSlug(input.name),
        kind: input.kind,
        config,
        credentialsCiphertext: encrypted,
        githubAppId,
        enabled: input.enabled,
        syncIntervalMinutes: input.syncIntervalMinutes,
        agentIds,
      }),
    );
  }
  if (!input.expectedVersion) throw badRequest("expectedVersion is required.");
  const updated = sourceRepository.updateSource({
    id: current.id,
    expectedVersion: input.expectedVersion,
    name: input.name,
    config,
    credentialsCiphertext: encrypted,
    githubAppId,
    enabled: input.enabled,
    syncIntervalMinutes: input.syncIntervalMinutes,
    expectedAccessVersion: input.expectedAccessVersion ?? current.accessVersion,
    agentIds,
  });
  if (!updated)
    throw conflict(
      "Source changed while you were editing it.",
      "SOURCE_VERSION_CONFLICT",
    );
  return publicSource(updated);
}

async function sourceAccess(source: KnowledgeSourceRecord) {
  const { secret } = readCredentials(source.credentialsCiphertext);
  if (
    source.config.kind === "github" &&
    source.config.authType === "github_app"
  ) {
    if (!source.githubAppId)
      throw badRequest("GitHub App connection is missing.");
    return { githubToken: await githubInstallationToken(source.githubAppId) };
  }
  return { secret };
}

export async function testKnowledgeSource(id: string) {
  const source = sourceRepository.getSource(id);
  if (!source) throw notFound("Source not found.");
  const result = await fetchKnowledgeSource(
    source.config,
    await sourceAccess(source),
    { limit: 1 },
  );
  return { connected: true, sampleCount: result.items.length };
}

function rootBody(source: KnowledgeSourceRecord) {
  const location =
    source.config.kind === "github"
      ? `https://github.com/${source.config.repository}`
      : source.config.siteUrl;
  return [
    `# ${source.name}`,
    "",
    source.config.kind === "github"
      ? "This document groups repository code and documentation synchronized by Slab Sources."
      : "This document groups knowledge synchronized by Slab Sources.",
    "",
    `- Source type: ${source.kind}`,
    `- Source: ${location}`,
    "- Managed automatically: yes",
    source.config.kind === "github"
      ? `- Branch: ${source.config.branch}`
      : null,
    "",
    "Child documents are refreshed from the external source. Edit the source configuration instead of these generated copies.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function contentHash(item: FetchedSourceItem, body: string) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        item.title,
        body,
        item.canonicalUrl,
        item.remoteUpdatedAt,
      ]),
    )
    .digest("hex");
}

function docSlug(source: KnowledgeSourceRecord, externalId: string) {
  const suffix = createHash("sha256")
    .update(externalId)
    .digest("hex")
    .slice(0, 10);
  return `${source.slug}-${slugify(externalId).slice(0, 55)}-${suffix}`.slice(
    0,
    100,
  );
}

function sourceItemTag(sourceId: string, externalId: string) {
  return `source-item:${createHash("sha256")
    .update(`${sourceId}:${externalId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function assertSyncLease(sourceId: string, syncId: string) {
  if (!sourceRepository.heartbeatSync(sourceId, syncId)) {
    throw conflict(
      "Source synchronization lease was lost.",
      "SOURCE_SYNC_LEASE_LOST",
    );
  }
}

async function ensureRoot(source: KnowledgeSourceRecord) {
  const body = rootBody(source);
  const tags = [
    "source",
    `source:${source.kind}`,
    `source-id:${source.id}`,
    `source-root:${source.id}`,
  ];
  if (source.rootDocumentId) {
    return {
      document: await DocsClient.update(source.rootDocumentId, {
        title: source.name,
        body,
        tags,
        collection_id: source.id,
        author: AUTHOR,
      }),
      created: false,
    };
  }
  const [orphan] = await DocsClient.list({
    tag: `source-root:${source.id}`,
    limit: 1,
    offset: 0,
  });
  if (orphan) {
    return {
      document: await DocsClient.update(orphan.id, {
        title: source.name,
        body,
        tags,
        collection_id: source.id,
        author: AUTHOR,
      }),
      created: false,
    };
  }
  return {
    document: await DocsClient.create({
      title: source.name,
      slug: `source-${source.slug}`.slice(0, 100),
      body,
      parent_id: null,
      tags,
      collection_id: source.id,
      author: AUTHOR,
    }),
    created: true,
  };
}

async function createOrRecoverChild(
  source: KnowledgeSourceRecord,
  item: FetchedSourceItem,
  input: Record<string, unknown>,
) {
  const tag = sourceItemTag(source.id, item.externalId);
  const [orphan] = await DocsClient.list({ tag, limit: 1, offset: 0 });
  if (orphan) {
    return {
      document: await DocsClient.update(orphan.id, input),
      created: false,
    };
  }
  return {
    document: await DocsClient.create({
      ...input,
      collection_id: source.id,
      slug: docSlug(source, item.externalId),
    }),
    created: true,
  };
}

export async function syncKnowledgeSource(id: string) {
  const startedAt = new Date().toISOString();
  const syncId = randomUUID();
  const source = sourceRepository.beginSync(id, startedAt, syncId);
  if (!source) {
    const current = sourceRepository.getSource(id);
    if (!current) throw notFound("Source not found.");
    throw conflict(
      current.enabled ? "Source is already syncing." : "Source is disabled.",
      "SOURCE_NOT_SYNCABLE",
    );
  }
  const heartbeat = setInterval(
    () => sourceRepository.heartbeatSync(source.id, syncId),
    30_000,
  );
  heartbeat.unref();
  try {
    await DocsClient.ensureCollection({
      id: source.id,
      name: source.name,
      kind: "source",
    });
    const fetched = await fetchKnowledgeSource(
      source.config,
      await sourceAccess(source),
    );
    if (!sourceRepository.heartbeatSync(source.id, syncId)) {
      throw conflict(
        "Source synchronization lease was lost.",
        "SOURCE_SYNC_LEASE_LOST",
      );
    }
    const current = sourceRepository.getSource(source.id);
    if (
      !current ||
      current.version !== source.version ||
      current.lastSyncStartedAt !== startedAt
    ) {
      throw conflict(
        "Source configuration changed during synchronization.",
        "SOURCE_VERSION_CONFLICT",
      );
    }
    assertSyncLease(source.id, syncId);
    const rootResult = await ensureRoot(source);
    const root = rootResult.document;
    if (!sourceRepository.ownsSync(source.id, syncId)) {
      throw conflict(
        "Source synchronization lease was lost.",
        "SOURCE_SYNC_LEASE_LOST",
      );
    }
    if (
      !source.rootDocumentId &&
      !sourceRepository.setRootDocumentForSync(
        source.id,
        startedAt,
        syncId,
        root.id,
      )
    ) {
      throw conflict(
        "Source synchronization lease was lost.",
        "SOURCE_SYNC_LEASE_LOST",
      );
    }
    const seen = new Set<string>();
    const uniqueItems = fetched.items.filter((item) => {
      if (seen.has(item.externalId)) return false;
      seen.add(item.externalId);
      return true;
    });
    const outcomes = await mapWithConcurrency(uniqueItems, 4, async (item) => {
      if (!sourceRepository.ownsSync(source.id, syncId)) {
        throw conflict(
          "Source synchronization lease was lost.",
          "SOURCE_SYNC_LEASE_LOST",
        );
      }
      const body = withSourceProvenance(item.body, {
        sourceName: source.name,
        canonicalUrl: item.canonicalUrl,
        externalId: item.externalId,
        remoteUpdatedAt: item.remoteUpdatedAt,
      });
      if (body.length > MAX_DOCUMENT_CHARACTERS) {
        throw badRequest(
          `Source document ${item.externalId} exceeds the managed document size limit.`,
          "SOURCE_DOCUMENT_TOO_LARGE",
        );
      }
      const hash = contentHash(item, body);
      const existing = sourceRepository.getItem(source.id, item.externalId);
      if (existing?.contentHash === hash) {
        if (!sourceRepository.markItemSeen(source.id, existing.id, syncId)) {
          throw conflict(
            "Source synchronization lease was lost.",
            "SOURCE_SYNC_LEASE_LOST",
          );
        }
        return "unchanged" as const;
      }
      const tags = [
        ...item.tags,
        `source-id:${source.id}`,
        sourceItemTag(source.id, item.externalId),
      ];
      const write = existing
        ? {
            document: await DocsClient.update(existing.documentId, {
              title: item.title,
              body,
              parent_id: root.id,
              tags,
              collection_id: source.id,
              author: AUTHOR,
            }),
            created: false,
          }
        : await createOrRecoverChild(source, item, {
            title: item.title,
            body,
            parent_id: root.id,
            tags,
            author: AUTHOR,
          });
      // If persistence throws after Docs accepted the write, the deterministic
      // source-item tag lets the next sync recover the visible orphan.
      const saved = sourceRepository.saveItem({
        sourceId: source.id,
        externalId: item.externalId,
        documentId: write.document.id,
        canonicalUrl: item.canonicalUrl,
        contentHash: hash,
        remoteUpdatedAt: item.remoteUpdatedAt,
        syncId,
      });
      if (!saved) {
        throw conflict(
          "Source synchronization lease was lost.",
          "SOURCE_SYNC_LEASE_LOST",
        );
      }
      return existing ? ("updated" as const) : ("created" as const);
    });
    const created = outcomes.filter((outcome) => outcome === "created").length;
    const updated = outcomes.filter((outcome) => outcome === "updated").length;
    const unchanged = outcomes.filter(
      (outcome) => outcome === "unchanged",
    ).length;
    let archived = 0;
    if (fetched.complete) {
      const stale = sourceRepository.listUnseenItems(source.id, syncId);
      await mapWithConcurrency(stale, 4, async (item) => {
        assertSyncLease(source.id, syncId);
        await DocsClient.archive(item.documentId);
        if (!sourceRepository.deleteItemForSync(source.id, item.id, syncId)) {
          throw conflict(
            "Source synchronization lease was lost.",
            "SOURCE_SYNC_LEASE_LOST",
          );
        }
      });
      archived = stale.length;
    }
    const completedAt = new Date().toISOString();
    const itemCount = sourceRepository.listItems(source.id).length;
    if (
      !sourceRepository.finishSync({
        id: source.id,
        syncId,
        startedAt,
        rootDocumentId: root.id,
        itemCount,
        completedAt,
      })
    ) {
      throw conflict(
        "Source synchronization lease was lost.",
        "SOURCE_SYNC_LEASE_LOST",
      );
    }
    return {
      source: getKnowledgeSource(source.id),
      created,
      updated,
      unchanged,
      archived,
      complete: fetched.complete,
    };
  } catch (error) {
    sourceRepository.failSync(
      source.id,
      startedAt,
      syncId,
      error instanceof Error ? error.message : "Synchronization failed.",
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function deleteKnowledgeSource(
  id: string,
  expectedVersion: number,
  archiveDocuments: boolean,
) {
  const existing = sourceRepository.getSource(id);
  if (!existing) throw notFound("Source not found.");
  const source = sourceRepository.beginDelete(id, expectedVersion);
  if (!source)
    throw conflict(
      existing.status === "syncing"
        ? "Source is currently syncing. Retry deletion when it finishes."
        : "Source changed before deletion.",
      "SOURCE_VERSION_CONFLICT",
    );
  try {
    // A source may be deleted before its first sync has materialized a Docs
    // collection. Ensure the idempotent collection exists so deletion remains
    // recoverable for both never-synced and previously-synced sources.
    await DocsClient.ensureCollection({
      id: source.id,
      name: source.name,
      kind: "source",
    });
    if (archiveDocuments) {
      for (const item of sourceRepository.listItems(id))
        await DocsClient.archive(item.documentId);
      if (source.rootDocumentId)
        await DocsClient.archive(source.rootDocumentId);
    } else {
      for (const item of sourceRepository.listItems(id)) {
        await DocsClient.update(item.documentId, {
          collection_id: "workspace",
          parent_id: null,
          author: AUTHOR,
        });
      }
      if (source.rootDocumentId) {
        await DocsClient.update(source.rootDocumentId, {
          collection_id: "workspace",
          parent_id: null,
          author: AUTHOR,
        });
      }
    }
    await DocsClient.archiveCollection(id);
    if (!sourceRepository.finishDelete(id, source.version)) {
      throw conflict(
        "Source deletion ownership was lost.",
        "SOURCE_VERSION_CONFLICT",
      );
    }
  } catch (error) {
    sourceRepository.failDelete(
      id,
      source.version,
      error instanceof Error ? error.message : "Source deletion failed.",
    );
    throw error;
  }
  return { id };
}
