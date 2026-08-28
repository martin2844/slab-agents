import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

import { knowledgeSourceInputSchema } from "../lib/api-schemas/source.ts";

register("./test-alias-loader.mjs", import.meta.url);

const migrationDirectory = path.resolve("db/migrations");

test("knowledge sources migrate, version writes are guarded, and secrets stay encrypted", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-sources-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  await migrations.migrate.latest();
  for (const table of [
    "knowledge_sources",
    "knowledge_source_items",
    "github_source_apps",
    "github_source_app_states",
  ]) {
    assert.equal(await migrations.schema.hasTable(table), true);
  }
  await migrations.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;

  const [{ sourceRepository }, secrets] = await Promise.all([
    import("../lib/repositories/source-repository.ts"),
    import("../lib/secrets.ts"),
  ]);
  const plaintext = "reader-secret-that-must-not-leak";
  const ciphertext = secrets.encryptLocalSecret(
    JSON.stringify({ secret: plaintext }),
  );
  assert.doesNotMatch(ciphertext, new RegExp(plaintext));
  assert.equal(
    JSON.parse(secrets.decryptLocalSecret(ciphertext)).secret,
    plaintext,
  );

  const source = sourceRepository.createSource({
    name: "Handbook",
    slug: "handbook",
    kind: "website",
    config: {
      kind: "website",
      siteUrl: "https://docs.example.test",
      sitemapUrl: null,
      authType: "bearer",
      username: null,
      includePathPrefixes: [],
      maxDocuments: 20,
    },
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: 60,
  });
  assert.equal(source.version, 1);
  assert.equal(
    sourceRepository.updateSource({
      id: source.id,
      expectedVersion: 99,
      name: "Stale",
      config: source.config,
      credentialsCiphertext: ciphertext,
      githubAppId: null,
      enabled: true,
      syncIntervalMinutes: 60,
    }),
    null,
  );
  const updated = sourceRepository.updateSource({
    id: source.id,
    expectedVersion: 1,
    name: "Current",
    config: source.config,
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: 60,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "Current");

  const app = sourceRepository.createGithubApp("Private docs", null);
  const state = "opaque-browser-state";
  const { createHash } = await import("node:crypto");
  sourceRepository.saveGithubState({
    stateHash: createHash("sha256").update(state).digest("hex"),
    githubAppId: app.id,
    action: "manifest",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(
    sourceRepository.consumeGithubState(
      createHash("sha256").update(state).digest("hex"),
      "manifest",
    ).id,
    app.id,
  );
  assert.equal(
    sourceRepository.consumeGithubState(
      createHash("sha256").update(state).digest("hex"),
      "manifest",
    ),
    null,
  );

  const [{ DocsClient }, service, githubApi] = await Promise.all([
    import("../lib/mcp/docs-client.ts"),
    import("../lib/sources/service.ts"),
    import("../lib/sources/github-app.ts"),
  ]);
  const originalFetch = globalThis.fetch;
  const originalDocs = { ...DocsClient };
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.assign(DocsClient, originalDocs);
  });
  const registration = githubApi.createGithubAppManifest({
    name: "Private knowledge",
    organization: "acme",
    origin: "https://agents.example.test",
  });
  assert.match(
    registration.actionUrl,
    /^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/,
  );
  assert.deepEqual(registration.manifest.default_permissions, {
    contents: "read",
    metadata: "read",
  });
  assert.equal("privateKey" in registration.app, false);
  globalThis.fetch = async () =>
    Response.json({
      id: 42,
      slug: "private-knowledge-test",
      pem: "test-private-key-material",
    });
  await githubApi.completeGithubManifest(
    "one-time-manifest-code",
    new URL(registration.actionUrl).searchParams.get("state"),
  );
  const registeredApp = sourceRepository.getGithubApp(registration.app.id);
  assert.equal(registeredApp.status, "pending_installation");
  assert.doesNotMatch(
    registeredApp.privateKeyCiphertext,
    /test-private-key-material/,
  );

  globalThis.fetch = async (input, init) => {
    assert.equal(
      new Headers(init.headers).get("authorization"),
      `Bearer ${plaintext}`,
    );
    const url = new URL(input);
    if (url.pathname === "/sitemap.xml") {
      return new Response(
        "<urlset><url><loc>https://docs.example.test/guide</loc></url></urlset>",
        { status: 200 },
      );
    }
    return new Response("<main><h1>Guide</h1><p>Current truth</p></main>", {
      status: 200,
    });
  };
  const documents = new Map();
  let createdDocuments = 0;
  let updatedDocuments = 0;
  DocsClient.create = async (input) => {
    createdDocuments += 1;
    const document = { id: `doc-${createdDocuments}`, ...input };
    documents.set(document.id, document);
    return document;
  };
  DocsClient.update = async (id, input) => {
    updatedDocuments += 1;
    const document = { ...documents.get(id), id, ...input };
    documents.set(id, document);
    return document;
  };
  DocsClient.archive = async (id) => ({ id });
  DocsClient.list = async ({ tag } = {}) =>
    [...documents.values()].filter(
      (document) =>
        !document.archived && (!tag || document.tags?.includes(tag)),
    );

  const firstSync = await service.syncKnowledgeSource(source.id);
  assert.equal(firstSync.created, 1);
  assert.equal(firstSync.source.itemCount, 1);
  assert.equal(firstSync.source.status, "healthy");
  assert.equal(
    createdDocuments,
    2,
    "one root and one managed child are created",
  );
  const secondSync = await service.syncKnowledgeSource(source.id);
  assert.equal(secondSync.unchanged, 1);
  assert.equal(createdDocuments, 2, "unchanged content is not recreated");
  assert.equal(
    updatedDocuments,
    1,
    "only the root metadata is refreshed on the repeat sync",
  );
  const partial = sourceRepository.createSource({
    name: "Partial source",
    slug: "partial-source",
    kind: "website",
    config: source.config,
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: null,
  });
  let partialRootCreates = 0;
  let failPartialChild = true;
  DocsClient.create = async (input) => {
    if (input.parent_id === null) {
      partialRootCreates += 1;
      const document = { id: "partial-root", ...input };
      documents.set(document.id, document);
      return document;
    }
    if (failPartialChild) throw new Error("simulated child write failure");
    const document = { id: "partial-child", ...input };
    documents.set(document.id, document);
    return document;
  };
  await assert.rejects(
    service.syncKnowledgeSource(partial.id),
    /simulated child write failure/,
  );
  assert.equal(
    sourceRepository.getSource(partial.id).rootDocumentId,
    "partial-root",
  );
  failPartialChild = false;
  await service.syncKnowledgeSource(partial.id);
  assert.equal(
    partialRootCreates,
    1,
    "a retry reuses the persisted root document",
  );

  const orphan = sourceRepository.createSource({
    name: "Recoverable source",
    slug: "recoverable-source",
    kind: "website",
    config: source.config,
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: null,
  });
  let recoverableChildCreates = 0;
  DocsClient.create = async (input) => {
    const isRoot = input.parent_id === null;
    const document = {
      id: isRoot
        ? "recoverable-root"
        : `recoverable-child-${++recoverableChildCreates}`,
      ...input,
    };
    documents.set(document.id, document);
    return document;
  };
  const originalSaveItem = sourceRepository.saveItem;
  let failMapping = true;
  sourceRepository.saveItem = (input) => {
    if (input.sourceId === orphan.id && failMapping) {
      failMapping = false;
      throw new Error("simulated mapping persistence failure");
    }
    return originalSaveItem(input);
  };
  await assert.rejects(
    service.syncKnowledgeSource(orphan.id),
    /simulated mapping persistence failure/,
  );
  await service.syncKnowledgeSource(orphan.id);
  assert.equal(
    recoverableChildCreates,
    1,
    "a retry recovers the child created before mapping persistence failed",
  );
  sourceRepository.saveItem = originalSaveItem;

  const { db } = await import("../lib/db/database.ts");
  const leaseStart = new Date().toISOString();
  assert.ok(sourceRepository.beginSync(source.id, leaseStart, "lease-a"));
  assert.equal(
    sourceRepository.beginSync(source.id, leaseStart, "lease-b"),
    null,
    "a live source lease cannot be taken over",
  );
  assert.equal(sourceRepository.heartbeatSync(source.id, "lease-a"), true);
  db.prepare("UPDATE knowledge_sources SET sync_heartbeat_at=? WHERE id=?").run(
    new Date(Date.now() - 16 * 60_000).toISOString(),
    source.id,
  );
  const replacementStart = new Date().toISOString();
  assert.ok(
    sourceRepository.beginSync(source.id, replacementStart, "lease-b"),
    "an abandoned lease can be recovered",
  );
  assert.equal(
    sourceRepository.saveItem({
      sourceId: source.id,
      externalId: "stale-worker-write",
      documentId: "stale-worker-doc",
      canonicalUrl: null,
      contentHash: "stale",
      remoteUpdatedAt: null,
      syncId: "lease-a",
    }),
    false,
    "a replaced worker cannot persist side effects",
  );
  sourceRepository.failSync(
    source.id,
    replacementStart,
    "lease-b",
    "test cleanup",
  );

  const scheduled = sourceRepository.createSource({
    name: "Scheduled source",
    slug: "scheduled-source",
    kind: "website",
    config: source.config,
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: 60,
  });
  assert.equal(
    sourceRepository
      .listDueSourceIds(new Date().toISOString())
      .includes(scheduled.id),
    false,
    "new scheduled sources wait for their configured interval",
  );
  db.prepare(
    "UPDATE knowledge_sources SET status='error',last_synced_at=?,last_sync_started_at=? WHERE id=?",
  ).run(
    new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    new Date().toISOString(),
    scheduled.id,
  );
  assert.equal(
    sourceRepository
      .listDueSourceIds(new Date().toISOString())
      .includes(scheduled.id),
    false,
    "a recent failed attempt wins over an older successful sync for retry cadence",
  );
  const staleAt = new Date(Date.now() - 16 * 60_000).toISOString();
  db.prepare(
    "UPDATE knowledge_sources SET status='syncing',sync_id='abandoned',last_sync_started_at=?,sync_heartbeat_at=? WHERE id=?",
  ).run(staleAt, staleAt, scheduled.id);
  assert.equal(
    sourceRepository
      .listDueSourceIds(new Date().toISOString())
      .includes(scheduled.id),
    true,
    "the scheduler recovers an abandoned sync lease",
  );
  assert.doesNotMatch(
    JSON.stringify(service.getSourcesPageData()),
    new RegExp(plaintext),
  );
  assert.throws(
    () =>
      service.saveKnowledgeSource({
        id: source.id,
        expectedVersion: 2,
        kind: "website",
        name: "Moved handbook",
        enabled: true,
        syncIntervalMinutes: 60,
        siteUrl: "https://different-origin.example",
        sitemapUrl: null,
        authType: "bearer",
        username: null,
        includePathPrefixes: [],
        maxDocuments: 20,
      }),
    /Authentication secret is required/,
  );

  const deleting = sourceRepository.createSource({
    name: "Deleting source",
    slug: "deleting-source",
    kind: "website",
    config: source.config,
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: null,
  });
  const deleteStart = new Date().toISOString();
  assert.ok(
    sourceRepository.beginSync(deleting.id, deleteStart, "delete-root"),
  );
  assert.equal(
    sourceRepository.setRootDocumentForSync(
      deleting.id,
      deleteStart,
      "delete-root",
      "delete-root-doc",
    ),
    true,
  );
  sourceRepository.failSync(
    deleting.id,
    deleteStart,
    "delete-root",
    "prepared for delete",
  );
  let concurrentSync;
  DocsClient.archive = async (id) => {
    concurrentSync = sourceRepository.beginSync(
      deleting.id,
      new Date().toISOString(),
      "must-not-start",
    );
    return { id };
  };
  await service.deleteKnowledgeSource(deleting.id, deleting.version, true);
  assert.equal(
    concurrentSync,
    null,
    "delete reserves the source before Docs writes",
  );
  assert.equal(sourceRepository.getSource(deleting.id), null);

  const retryDelete = sourceRepository.createSource({
    name: "Retry delete",
    slug: "retry-delete",
    kind: "website",
    config: source.config,
    credentialsCiphertext: ciphertext,
    githubAppId: null,
    enabled: true,
    syncIntervalMinutes: null,
  });
  const retryStart = new Date().toISOString();
  sourceRepository.beginSync(retryDelete.id, retryStart, "retry-root");
  sourceRepository.setRootDocumentForSync(
    retryDelete.id,
    retryStart,
    "retry-root",
    "retry-root-doc",
  );
  sourceRepository.failSync(
    retryDelete.id,
    retryStart,
    "retry-root",
    "prepared for delete retry",
  );
  DocsClient.archive = async () => {
    throw new Error("temporary Docs failure");
  };
  await assert.rejects(
    service.deleteKnowledgeSource(retryDelete.id, retryDelete.version, true),
    /temporary Docs failure/,
  );
  const reserved = sourceRepository.getSource(retryDelete.id);
  assert.equal(reserved.status, "deleting");
  assert.equal(
    sourceRepository.beginSync(
      retryDelete.id,
      new Date().toISOString(),
      "must-not-retry-sync",
    ),
    null,
  );
  DocsClient.archive = async (id) => ({ id });
  await service.deleteKnowledgeSource(retryDelete.id, reserved.version, true);
  assert.equal(sourceRepository.getSource(retryDelete.id), null);

  const rawDatabase = await readFile(filename);
  assert.equal(rawDatabase.includes(Buffer.from(plaintext)), false);
});

test("source schema rejects credential-bearing URLs and unsafe limits", () => {
  assert.throws(() =>
    knowledgeSourceInputSchema.parse({
      kind: "website",
      name: "Unsafe",
      siteUrl: "https://operator:secret@example.test/docs",
      maxDocuments: 10,
    }),
  );
  assert.throws(() =>
    knowledgeSourceInputSchema.parse({
      kind: "website",
      name: "Too broad",
      siteUrl: "https://example.test",
      maxDocuments: 501,
    }),
  );
});

test("source HTTP injects auth server-side and blocks cross-origin redirects", async (t) => {
  const { fetchSourceText } = await import("../lib/sources/source-http.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let observedAuthorization = "";
  globalThis.fetch = async (_url, init) => {
    observedAuthorization =
      new Headers(init.headers).get("authorization") ?? "";
    return new Response("ok", { status: 200 });
  };
  const result = await fetchSourceText("https://docs.example.test/guide", {
    credentials: { authType: "bearer", secret: "private-token" },
    expectedOrigin: "https://docs.example.test",
  });
  assert.equal(result.text, "ok");
  assert.equal(observedAuthorization, "Bearer private-token");

  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "https://evil.example/collect" },
    });
  await assert.rejects(
    fetchSourceText("https://docs.example.test/guide", {
      credentials: { authType: "bearer", secret: "private-token" },
      expectedOrigin: "https://docs.example.test",
    }),
    (error) => error.code === "SOURCE_REDIRECT_BLOCKED",
  );
});

test("source HTTP refuses oversized responses without returning truncated content", async (t) => {
  const { fetchSourceText } = await import("../lib/sources/source-http.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response("x".repeat(64), { status: 200 });
  await assert.rejects(
    fetchSourceText("https://docs.example.test/large", {
      credentials: { authType: "none" },
      expectedOrigin: "https://docs.example.test",
      maxBytes: 32,
    }),
    (error) => error.code === "SOURCE_RESPONSE_TOO_LARGE",
  );
});

test("source timeout covers a stalled response body, not only response headers", async (t) => {
  const { fetchSourceText } = await import("../lib/sources/source-http.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      }),
      { status: 200 },
    );
  await assert.rejects(
    fetchSourceText("https://docs.example.test/stalled", {
      credentials: { authType: "none" },
      expectedOrigin: "https://docs.example.test",
      timeoutMs: 20,
    }),
    (error) => error.code === "SOURCE_TIMEOUT",
  );
});

test("WordPress and website content is converted into compact Markdown", async () => {
  const { htmlToMarkdown, webpageToDocument, withSourceProvenance } =
    await import("../lib/sources/source-content.ts");
  assert.equal(
    htmlToMarkdown(
      "<p>Hello <strong>world</strong></p><script>secret()</script>",
    ),
    "Hello **world**",
  );
  assert.deepEqual(
    webpageToDocument(
      "<html><head><title>Fallback</title></head><body><nav>Menu</nav><main><h1>Guide</h1><p>Useful</p></main></body></html>",
      "Page",
    ),
    { title: "Guide", body: "# Guide\n\nUseful" },
  );
  const mirrored = withSourceProvenance("Body", {
    sourceName: "Handbook",
    canonicalUrl: "https://docs.example.test/guide",
    externalId: "guide",
    remoteUpdatedAt: null,
  });
  assert.match(mirrored, /Managed by Slab Sources/);
  assert.match(mirrored, /https:\/\/docs\.example\.test\/guide/);
});

test("WordPress, GitHub, and sitemap connectors expose bounded semantic documents", async (t) => {
  const { fetchKnowledgeSource } = await import("../lib/sources/connectors.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/wp-json/wp/v2/pages");
    assert.equal(url.searchParams.get("_fields")?.includes("content"), true);
    return Response.json(
      [
        {
          id: 7,
          slug: "guide",
          link: "https://wordpress.example/guide",
          modified_gmt: "2026-08-28T08:00:00",
          title: { rendered: "<b>Guide</b>" },
          content: { rendered: "<h2>Start</h2><p>Useful</p>" },
        },
      ],
      { headers: { "x-wp-totalpages": "1" } },
    );
  };
  const wordpress = await fetchKnowledgeSource(
    {
      kind: "wordpress",
      siteUrl: "https://wordpress.example",
      authType: "none",
      username: null,
      contentTypes: ["pages"],
      publishedOnly: true,
      maxDocuments: 20,
    },
    {},
  );
  assert.deepEqual(
    wordpress.items.map(({ externalId, title }) => ({ externalId, title })),
    [{ externalId: "pages:7", title: "Guide" }],
  );
  assert.match(wordpress.items[0].body, /## Start/);

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/git/trees/main")) {
      return Response.json({
        truncated: false,
        tree: [
          { path: "docs/runbook.md", type: "blob", sha: "abc", size: 12 },
          { path: "src/secret.ts", type: "blob", sha: "def", size: 12 },
        ],
      });
    }
    assert.equal(url.pathname.endsWith("/git/blobs/abc"), true);
    return Response.json({
      encoding: "base64",
      content: Buffer.from("# Runbook").toString("base64"),
    });
  };
  const github = await fetchKnowledgeSource(
    {
      kind: "github",
      repository: "slab/example",
      branch: "main",
      authType: "none",
      pathPrefixes: ["docs"],
      extensions: ["md"],
      maxDocuments: 20,
    },
    {},
  );
  assert.deepEqual(
    github.items.map((item) => item.externalId),
    ["docs/runbook.md"],
  );
  assert.equal(github.items[0].body, "# Runbook");

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/sitemap.xml") {
      return new Response(
        "<urlset><url><loc>https://site.example/docs/a</loc></url><url><loc>https://other.example/leak</loc></url></urlset>",
        { status: 200 },
      );
    }
    assert.equal(url.pathname, "/docs/a");
    return new Response("<main><h1>A</h1><p>Body</p></main>", { status: 200 });
  };
  const website = await fetchKnowledgeSource(
    {
      kind: "website",
      siteUrl: "https://site.example",
      sitemapUrl: null,
      authType: "none",
      username: null,
      includePathPrefixes: ["/docs"],
      maxDocuments: 20,
    },
    {},
  );
  assert.deepEqual(
    website.items.map((item) => item.externalId),
    ["https://site.example/docs/a"],
  );
  assert.equal(website.complete, true);
});

test("website sitemap failures and capped traversal never authorize stale pruning", async (t) => {
  const { fetchKnowledgeSource } = await import("../lib/sources/connectors.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const config = {
    kind: "website",
    siteUrl: "https://site.example",
    sitemapUrl: null,
    authType: "none",
    username: null,
    includePathPrefixes: [],
    maxDocuments: 20,
  };

  globalThis.fetch = async () => new Response("temporary", { status: 500 });
  await assert.rejects(
    fetchKnowledgeSource(config, {}),
    (error) => error.code === "SOURCE_HTTP_ERROR",
  );

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/sitemap.xml")
      return new Response("missing", { status: 404 });
    return new Response("<main><h1>Home</h1></main>", { status: 200 });
  };
  const fallback = await fetchKnowledgeSource(config, {});
  assert.equal(fallback.items.length, 1);
  assert.equal(fallback.complete, false);

  globalThis.fetch = async () =>
    new Response("<urlset></urlset>", { status: 200 });
  await assert.rejects(
    fetchKnowledgeSource(config, {}),
    (error) => error.code === "SOURCE_INVALID_RESPONSE",
  );

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const level = Number(url.pathname.match(/(\d+)/)?.[1] ?? 0);
    return new Response(
      `<sitemapindex><sitemap><loc>https://site.example/sitemap-${level + 1}.xml</loc></sitemap></sitemapindex>`,
      { status: 200 },
    );
  };
  const capped = await fetchKnowledgeSource(config, {});
  assert.equal(capped.items.length, 0);
  assert.equal(capped.complete, false);
});

test("GitHub connector enforces an aggregate decoded-content budget", async (t) => {
  const { fetchKnowledgeSource } = await import("../lib/sources/connectors.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const oneMiB = "x".repeat(1024 * 1024);
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("/git/trees/")) {
      return Response.json({
        truncated: false,
        tree: Array.from({ length: 34 }, (_, index) => ({
          path: `docs/${index}.md`,
          type: "blob",
          sha: String(index),
          size: oneMiB.length,
        })),
      });
    }
    return Response.json({
      encoding: "base64",
      content: Buffer.from(oneMiB).toString("base64"),
    });
  };
  await assert.rejects(
    fetchKnowledgeSource(
      {
        kind: "github",
        repository: "slab/large",
        branch: "main",
        authType: "none",
        pathPrefixes: ["docs"],
        extensions: ["md"],
        maxDocuments: 100,
      },
      {},
    ),
    (error) => error.code === "SOURCE_COLLECTION_TOO_LARGE",
  );
});

test("connectors fail closed instead of pruning malformed fetched items", async (t) => {
  const { fetchKnowledgeSource } = await import("../lib/sources/connectors.ts");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("/git/trees/")) {
      return Response.json({
        truncated: false,
        tree: [{ path: "docs/guide.md", type: "blob", sha: "bad", size: 12 }],
      });
    }
    return Response.json({ encoding: "utf8", content: "not base64" });
  };
  await assert.rejects(
    fetchKnowledgeSource(
      {
        kind: "github",
        repository: "slab/malformed",
        branch: "main",
        authType: "none",
        pathPrefixes: ["docs"],
        extensions: ["md"],
        maxDocuments: 20,
      },
      {},
    ),
    (error) => error.code === "SOURCE_INVALID_RESPONSE",
  );

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/sitemap.xml") {
      return new Response(
        "<urlset><url><loc>https://site.example/empty</loc></url></urlset>",
        { status: 200 },
      );
    }
    return new Response(
      "<html><body><nav>Only navigation</nav></body></html>",
      {
        status: 200,
      },
    );
  };
  await assert.rejects(
    fetchKnowledgeSource(
      {
        kind: "website",
        siteUrl: "https://site.example",
        sitemapUrl: null,
        authType: "none",
        username: null,
        includePathPrefixes: [],
        maxDocuments: 20,
      },
      {},
    ),
    (error) => error.code === "SOURCE_INVALID_RESPONSE",
  );
});

test("Sources UI exposes the full operational setup without a generic HTTP tool", async () => {
  const source = await readFile(
    new URL("../components/sources-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /WordPress/);
  assert.match(source, /GitHub App/);
  assert.match(source, /Website \/ sitemap/);
  assert.match(source, /private repositories/);
  assert.match(source, /Save and sync/);
  assert.match(source, /Test again/);
  assert.match(source, /Could not refresh Sources/);
  assert.doesNotMatch(source, /http_request/);
});
