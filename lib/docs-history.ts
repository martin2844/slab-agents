import "server-only";
import { getSetting } from "@/lib/settings";
import { DomainError } from "@/lib/api";
import type { DocSnapshot } from "@/lib/docs-run-changes";
export type DocsCommit = {
  id: string;
  run_id: string | null;
  author: string;
  message: string;
  created_at: string;
  reverts_id: string | null;
  documentCount: number;
};
export type DocsCommitDetail = DocsCommit & {
  changes: Array<{
    documentId: string;
    before: DocSnapshot | null;
    after: DocSnapshot;
    conflict: string | null;
  }>;
};
export type DocsProposal = {
  run_id: string;
  author: string;
  closed_at: string;
  documentCount: number;
  merge_error: string | null;
};
export async function docsHistoryRequest<T>(
  path: string,
  method = "GET",
): Promise<T> {
  const url = new URL(getSetting("docs_mcp_url"));
  url.pathname = `/api/${path.split("?")[0]}`;
  url.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  url.hash = "";
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getSetting("docs_api_key")}`,
      "Content-Type": "application/json",
    },
    ...(method === "POST" ? { body: "{}" } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data)
    throw new DomainError(
      "DOCS_HISTORY_UNAVAILABLE",
      payload?.error?.message ?? "Could not load document history.",
      response.status === 409 ? 409 : 502,
    );
  return payload.data as T;
}
