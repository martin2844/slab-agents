import "server-only";

import { XMLParser } from "fast-xml-parser";
import type {
  GitHubSourceConfig,
  KnowledgeSourceConfig,
  WebsiteSourceConfig,
  WordPressSourceConfig,
} from "@/lib/types";
import { OperationalError } from "@/lib/operational-error";
import { mapWithConcurrency } from "@/lib/async";
import {
  fetchSourceJson,
  fetchSourceText,
  type SourceHttpCredentials,
} from "@/lib/sources/source-http";
import {
  htmlText,
  htmlToMarkdown,
  webpageToDocument,
} from "@/lib/sources/source-content";
import {
  formatGitHubFileBody,
  githubFileDescriptor,
  normalizeGitHubFileSelectors,
} from "@/lib/sources/github-files";

export type FetchedSourceItem = {
  externalId: string;
  title: string;
  body: string;
  canonicalUrl: string | null;
  remoteUpdatedAt: string | null;
  tags: string[];
};

export type SourceFetchResult = {
  items: FetchedSourceItem[];
  complete: boolean;
};

export const MAX_SOURCE_COLLECTION_BYTES = 32 * 1024 * 1024;

function collectionBudget() {
  let bytes = 0;
  return (value: string) => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > MAX_SOURCE_COLLECTION_BYTES) {
      throw new OperationalError(
        "Source content exceeds the 32 MiB collection limit. Narrow the configured paths or reduce the document limit.",
        "SOURCE_COLLECTION_TOO_LARGE",
        400,
      );
    }
  };
}

type WordPressRecord = {
  id?: number;
  slug?: string;
  link?: string;
  modified_gmt?: string;
  status?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
};

function sourceCredentials(
  config: WordPressSourceConfig | WebsiteSourceConfig,
  secret?: string,
): SourceHttpCredentials {
  return {
    authType: config.authType,
    username: config.username,
    secret,
  };
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function fetchWordPress(
  config: WordPressSourceConfig,
  secret: string | undefined,
  itemLimit: number,
): Promise<SourceFetchResult> {
  const base = normalizeBaseUrl(config.siteUrl);
  const credentials = sourceCredentials(config, secret);
  const items: FetchedSourceItem[] = [];
  const addToBudget = collectionBudget();
  let exhausted = true;

  for (const contentType of config.contentTypes) {
    for (let page = 1; page <= 100; page += 1) {
      if (items.length >= itemLimit) {
        exhausted = false;
        break;
      }
      const endpoint = new URL(
        `${base.pathname === "/" ? "" : base.pathname}/wp-json/wp/v2/${encodeURIComponent(contentType)}`,
        base,
      );
      endpoint.searchParams.set("per_page", String(Math.min(100, itemLimit)));
      endpoint.searchParams.set("page", String(page));
      endpoint.searchParams.set("orderby", "modified");
      endpoint.searchParams.set("order", "desc");
      endpoint.searchParams.set(
        "_fields",
        "id,slug,link,modified_gmt,status,title,content,excerpt",
      );
      if (config.publishedOnly) endpoint.searchParams.set("status", "publish");

      const response = await fetchSourceJson<WordPressRecord[]>(endpoint, {
        credentials,
        expectedOrigin: base.origin,
      });
      if (!Array.isArray(response.data)) {
        throw new OperationalError(
          "WordPress returned an invalid collection.",
          "SOURCE_INVALID_RESPONSE",
          502,
        );
      }
      for (const record of response.data) {
        if (items.length >= itemLimit) {
          exhausted = false;
          break;
        }
        if (typeof record.id !== "number") continue;
        const content = htmlToMarkdown(
          record.content?.rendered || record.excerpt?.rendered || "",
        );
        addToBudget(content);
        items.push({
          externalId: `${contentType}:${record.id}`,
          title:
            htmlText(record.title?.rendered ?? "") ||
            record.slug ||
            `${contentType} ${record.id}`,
          body: content,
          canonicalUrl: record.link ?? null,
          remoteUpdatedAt: record.modified_gmt
            ? new Date(`${record.modified_gmt}Z`).toISOString()
            : null,
          tags: ["wordpress", contentType.slice(0, 64)],
        });
        items[items.length - 1].title = items[items.length - 1].title.slice(
          0,
          200,
        );
      }
      const totalPages = Number(response.headers.get("x-wp-totalpages") ?? 1);
      if (!response.data.length || page >= totalPages) break;
    }
    if (!exhausted) break;
  }
  return { items, complete: exhausted };
}

type GitHubTreeResponse = {
  truncated?: boolean;
  tree?: Array<{
    path?: string;
    type?: string;
    sha?: string;
    size?: number;
    url?: string;
  }>;
};
type GitHubBlobResponse = { content?: string; encoding?: string };

function githubHeaders(token?: string): SourceHttpCredentials {
  return { authType: token ? "bearer" : "none", secret: token };
}

function githubPathIncluded(path: string, prefixes: string[]) {
  if (!prefixes.length) return true;
  return prefixes.some((prefix) => {
    const normalized = prefix.replace(/^\/+|\/+$/g, "");
    return (
      !normalized || path === normalized || path.startsWith(`${normalized}/`)
    );
  });
}

async function fetchGitHub(
  config: GitHubSourceConfig,
  token: string | undefined,
  itemLimit: number,
): Promise<SourceFetchResult> {
  const [owner, repository] = config.repository.split("/");
  const apiOrigin = "https://api.github.com";
  const treeUrl = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(config.branch)}`,
    apiOrigin,
  );
  treeUrl.searchParams.set("recursive", "1");
  const tree = await fetchSourceJson<GitHubTreeResponse>(treeUrl, {
    credentials: githubHeaders(token),
    expectedOrigin: apiOrigin,
    accept: "application/vnd.github+json",
    maxBytes: 8 * 1024 * 1024,
  });
  if (!Array.isArray(tree.data.tree)) {
    throw new OperationalError(
      "GitHub returned an invalid repository tree.",
      "SOURCE_INVALID_RESPONSE",
      502,
    );
  }
  if (tree.data.truncated) {
    throw new OperationalError(
      "GitHub truncated this repository tree. Narrow the configured paths.",
      "SOURCE_COLLECTION_TOO_LARGE",
      400,
    );
  }
  const selectors = normalizeGitHubFileSelectors(config.extensions);
  const matching = tree.data.tree.flatMap((entry) => {
    if (
      entry.type !== "blob" ||
      typeof entry.path !== "string" ||
      typeof entry.sha !== "string" ||
      !githubPathIncluded(entry.path, config.pathPrefixes)
    ) {
      return [];
    }
    const descriptor = githubFileDescriptor(entry.path, selectors);
    return descriptor ? [{ entry, descriptor }] : [];
  });
  const oversized = matching.find(
    ({ entry }) => (entry.size ?? 0) > 1024 * 1024,
  );
  if (oversized?.entry.path) {
    throw new OperationalError(
      `GitHub file ${oversized.entry.path} exceeds the 1 MiB document limit. Narrow the configured paths.`,
      "SOURCE_DOCUMENT_TOO_LARGE",
      400,
    );
  }
  const blobs = matching.slice(0, itemLimit);
  const addToBudget = collectionBudget();

  const items: FetchedSourceItem[] = await mapWithConcurrency(
    blobs,
    5,
    async ({ entry, descriptor }) => {
      const path = entry.path!;
      const blobUrl = new URL(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs/${encodeURIComponent(entry.sha!)}`,
        apiOrigin,
      );
      const blob = await fetchSourceJson<GitHubBlobResponse>(blobUrl, {
        credentials: githubHeaders(token),
        expectedOrigin: apiOrigin,
        accept: "application/vnd.github+json",
        maxBytes: 2 * 1024 * 1024,
      });
      if (
        blob.data.encoding !== "base64" ||
        typeof blob.data.content !== "string"
      ) {
        throw new OperationalError(
          `GitHub returned invalid content for ${path}.`,
          "SOURCE_INVALID_RESPONSE",
          502,
        );
      }
      const decoded = Buffer.from(
        blob.data.content.replace(/\s/g, ""),
        "base64",
      );
      let body: string;
      try {
        body = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
      } catch {
        throw new OperationalError(
          `GitHub file ${path} is not valid UTF-8 text.`,
          "SOURCE_INVALID_RESPONSE",
          502,
        );
      }
      addToBudget(body);
      return {
        externalId: path,
        title: path.slice(0, 200),
        body: formatGitHubFileBody(body, descriptor),
        canonicalUrl: `https://github.com/${owner}/${repository}/blob/${encodeURIComponent(config.branch)}/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        remoteUpdatedAt: null,
        tags: [
          "github",
          descriptor.kind === "code" ? "repository-code" : "repository-docs",
          `language:${descriptor.language}`,
        ],
      } satisfies FetchedSourceItem;
    },
  );
  return { items, complete: matching.length <= itemLimit };
}

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function xmlLocations(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const rows = root.urlset
    ? (root.urlset as Record<string, unknown>).url
    : root.sitemapindex
      ? (root.sitemapindex as Record<string, unknown>).sitemap
      : [];
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return list
    .map((row) =>
      row && typeof row === "object"
        ? (row as Record<string, unknown>).loc
        : null,
    )
    .filter((location): location is string => typeof location === "string");
}

function pathIncluded(url: URL, prefixes: string[]) {
  if (!prefixes.length) return true;
  return prefixes.some((prefix) => {
    const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
    return (
      url.pathname === normalized || url.pathname.startsWith(`${normalized}/`)
    );
  });
}

async function websiteUrls(
  config: WebsiteSourceConfig,
  secret: string | undefined,
  itemLimit: number,
) {
  const base = normalizeBaseUrl(config.siteUrl);
  const sitemap = config.sitemapUrl
    ? new URL(config.sitemapUrl)
    : new URL("/sitemap.xml", base);
  if (sitemap.origin !== base.origin) {
    throw new OperationalError(
      "Website sitemap must use the configured website origin.",
      "SOURCE_ORIGIN_MISMATCH",
    );
  }
  const credentials = sourceCredentials(config, secret);
  const pending = [sitemap];
  const visitedSitemaps = new Set<string>();
  const urls: URL[] = [];
  let complete = true;
  while (
    pending.length &&
    visitedSitemaps.size < 10 &&
    urls.length < itemLimit
  ) {
    const current = pending.shift()!;
    if (visitedSitemaps.has(current.toString())) continue;
    visitedSitemaps.add(current.toString());
    let result;
    try {
      result = await fetchSourceText(current, {
        credentials,
        expectedOrigin: base.origin,
        accept: "application/xml, text/xml, */*;q=0.2",
        maxBytes: 2 * 1024 * 1024,
      });
    } catch (error) {
      if (
        !config.sitemapUrl &&
        current.toString() === sitemap.toString() &&
        error instanceof OperationalError &&
        error.code === "SOURCE_HTTP_NOT_FOUND"
      ) {
        if (pathIncluded(base, config.includePathPrefixes)) urls.push(base);
        complete = false;
        break;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = xmlParser.parse(result.text);
    } catch {
      throw new OperationalError(
        "Website sitemap returned invalid XML.",
        "SOURCE_INVALID_RESPONSE",
        502,
      );
    }
    const locations = xmlLocations(parsed);
    const sitemapIndex =
      parsed && typeof parsed === "object" && "sitemapindex" in parsed;
    const urlSet = parsed && typeof parsed === "object" && "urlset" in parsed;
    if ((!sitemapIndex && !urlSet) || locations.length === 0) {
      throw new OperationalError(
        "Website sitemap did not contain a valid, non-empty URL collection.",
        "SOURCE_INVALID_RESPONSE",
        502,
      );
    }
    for (const location of locations) {
      const candidate = new URL(location, base);
      if (candidate.origin !== base.origin) continue;
      candidate.hash = "";
      if (sitemapIndex) pending.push(candidate);
      else if (pathIncluded(candidate, config.includePathPrefixes))
        urls.push(candidate);
      if (urls.length >= itemLimit) break;
    }
  }
  if (pending.length > 0 || urls.length >= itemLimit) complete = false;
  return {
    urls: [...new Map(urls.map((url) => [url.toString(), url])).values()],
    base,
    credentials,
    complete,
  };
}

async function fetchWebsite(
  config: WebsiteSourceConfig,
  secret: string | undefined,
  itemLimit: number,
): Promise<SourceFetchResult> {
  const { urls, base, credentials, complete } = await websiteUrls(
    config,
    secret,
    itemLimit,
  );
  const addToBudget = collectionBudget();
  const items: FetchedSourceItem[] = await mapWithConcurrency(
    urls,
    5,
    async (url) => {
      const result = await fetchSourceText(url, {
        credentials,
        expectedOrigin: base.origin,
        accept: "text/html, text/plain;q=0.8",
        maxBytes: 2 * 1024 * 1024,
      });
      const document = webpageToDocument(
        result.text,
        url.pathname || base.hostname,
      );
      if (!document.body) {
        throw new OperationalError(
          `Website page ${url.pathname || "/"} did not contain readable content.`,
          "SOURCE_INVALID_RESPONSE",
          502,
        );
      }
      addToBudget(document.body);
      return {
        externalId: url.toString(),
        title: document.title,
        body: document.body,
        canonicalUrl: url.toString(),
        remoteUpdatedAt: result.headers.get("last-modified"),
        tags: ["website"],
      } satisfies FetchedSourceItem;
    },
  );
  return { items, complete };
}

export async function fetchKnowledgeSource(
  config: KnowledgeSourceConfig,
  credentials: { secret?: string; githubToken?: string },
  options: { limit?: number } = {},
) {
  const limit = Math.min(
    config.maxDocuments,
    options.limit ?? config.maxDocuments,
  );
  switch (config.kind) {
    case "wordpress":
      return fetchWordPress(config, credentials.secret, limit);
    case "github":
      return fetchGitHub(
        config,
        credentials.githubToken ?? credentials.secret,
        limit,
      );
    case "website":
      return fetchWebsite(config, credentials.secret, limit);
  }
}
