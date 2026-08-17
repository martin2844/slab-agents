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

export const DocsClient = {
  list: async (input: Record<string, unknown> = {}) =>
    unwrap(
      await callMcpTool<{ data: DocumentSummary[] } | DocumentSummary[]>(
        connection(),
        "list_docs",
        { archived: false, limit: 100, offset: 0, ...input },
      ),
    ),
  search: async (q: string) =>
    unwrap(
      await callMcpTool<
        { data: DocumentSearchResult[] } | DocumentSearchResult[]
      >(
        connection(),
        "search_docs",
        { query: q, limit: 50 },
      ),
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
      >(
        connection(),
        "create_doc",
        input,
      ),
    );
    return DocsClient.get(created.id);
  },
  update: async (id: string, input: Record<string, unknown>) => {
    const updated = unwrap(
      await callMcpTool<
        { data: DocumentMutationResult } | DocumentMutationResult
      >(
        connection(),
        "update_doc",
        { id, ...input },
      ),
    );
    return DocsClient.get(updated.id);
  },
  archive: async (id: string) =>
    unwrap(
      await callMcpTool<
        { data: DocumentMutationResult } | DocumentMutationResult
      >(
        connection(),
        "archive_doc",
        { id },
      ),
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
