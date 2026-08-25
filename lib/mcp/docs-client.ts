import "server-only";

import { callMcpTool, testMcp } from "@/lib/mcp/client";
import { getSetting } from "@/lib/settings";
import type {
  Document,
  DocumentMutationResult,
  DocumentRevision,
  DocumentSearchResult,
  DocumentSummary,
} from "@/lib/types";
import { collectOffsetPages } from "@/lib/pagination";

function connection() {
  return {
    url: getSetting("docs_mcp_url"),
    apiKey: getSetting("docs_api_key"),
  };
}
function unwrap<T>(value: { data?: T } | T): T {
  return value && typeof value === "object" && "data" in value
    ? (value as { data: T }).data
    : (value as T);
}

const PAGE_SIZE = 100;
const MAX_DOCUMENTS = 10_000;

type DocumentPage = {
  data?: DocumentSummary[];
  documents?: DocumentSummary[];
  total?: number;
  has_more?: boolean;
};

export const DocsClient = {
  list: async (input: Record<string, unknown> = {}) => {
    if (input.limit !== undefined || input.offset !== undefined) {
      return unwrap(
        await callMcpTool<{ data: DocumentSummary[] } | DocumentSummary[]>(
          connection(),
          "list_docs",
          { archived: false, ...input },
        ),
      );
    }
    return collectOffsetPages({
      pageSize: PAGE_SIZE,
      maxItems: MAX_DOCUMENTS,
      label: "Docs",
      fetchPage: async (limit, offset) => {
        const result = await callMcpTool<DocumentPage | DocumentSummary[]>(
          connection(),
          "list_docs",
          { archived: false, ...input, limit, offset },
        );
        return {
          items: Array.isArray(result)
            ? result
            : (result.documents ?? result.data ?? []),
          total:
            !Array.isArray(result) && typeof result.total === "number"
              ? result.total
              : null,
          hasMore: Array.isArray(result) ? undefined : result.has_more,
        };
      },
    });
  },
  search: async (q: string) =>
    unwrap(
      await callMcpTool<
        { data: DocumentSearchResult[] } | DocumentSearchResult[]
      >(connection(), "search_docs", { query: q, limit: 50 }),
    ),
  get: async (id: string) =>
    unwrap(
      await callMcpTool<{ data: Document } | Document>(
        connection(),
        "get_doc",
        { id },
      ),
    ),
  create: async (input: Record<string, unknown>) => {
    const created = unwrap(
      await callMcpTool<
        { data: DocumentMutationResult } | DocumentMutationResult
      >(connection(), "create_doc", input),
    );
    return DocsClient.get(created.id);
  },
  update: async (id: string, input: Record<string, unknown>) => {
    const updated = unwrap(
      await callMcpTool<
        { data: DocumentMutationResult } | DocumentMutationResult
      >(connection(), "update_doc", { id, ...input }),
    );
    return DocsClient.get(updated.id);
  },
  archive: async (id: string) =>
    unwrap(
      await callMcpTool<
        { data: DocumentMutationResult } | DocumentMutationResult
      >(connection(), "archive_doc", { id }),
    ),
  revisions: async (id: string) =>
    unwrap(
      await callMcpTool<{ data: DocumentRevision[] } | DocumentRevision[]>(
        connection(),
        "list_doc_revisions",
        { id },
      ),
    ),
  revision: async (id: string, revision: number) =>
    unwrap(
      await callMcpTool<{ data: DocumentRevision } | DocumentRevision>(
        connection(),
        "get_doc_revision",
        { id, revision },
      ),
    ),
  test: () => testMcp(connection()),
};
