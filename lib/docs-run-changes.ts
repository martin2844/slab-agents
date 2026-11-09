import "server-only";
import {
  docsRunRepository,
  type DocsRunAccess,
} from "@/lib/repositories/docs-run-repository";
import { getSetting } from "@/lib/settings";
import { runRepository } from "@/lib/repositories/run-repository";
import { conflict, DomainError, notFound } from "@/lib/api";
import type { Document } from "@/lib/types";

export type DocSnapshot = Omit<Document, "author" | "revision"> & {
  version: number;
};
export type RunDocumentChange = {
  documentId: string;
  before: DocSnapshot | null;
  after: DocSnapshot;
  operations: Array<{ before: DocSnapshot | null; after: DocSnapshot }>;
  interleaved: boolean;
  undoneAt: string | null;
  conflict: string | null;
};
export type RunDocsChanges = {
  recorded: boolean;
  closed: boolean;
  changes: RunDocumentChange[];
  runStatus: string;
  editingMode?: "direct" | "review" | "auto";
  state?: "editing" | "pending" | "merged" | "rejected" | "empty";
  author?: string;
  commitId?: string | null;
  mergeError?: string | null;
};
type Access = DocsRunAccess;
const terminal = new Set(["completed", "failed", "cancelled", "skipped"]);
const accessFor = docsRunRepository.get;
export const registerDocsRunAccess = docsRunRepository.register;

async function requestDocs<T>(
  access: Access,
  action: "" | "/close" | "/undo" | "/merge" | "/reject",
  body?: unknown,
): Promise<T> {
  if (access.service_url !== getSetting("docs_mcp_url"))
    throw conflict(
      "The Docs connection has changed since this run. Restore that connection to review its changes.",
    );
  const url = new URL(access.service_url);
  url.pathname = `/api/run-changes/${encodeURIComponent(access.run_id)}${action}`;
  url.search = "";
  url.hash = "";
  const response = await fetch(url, {
    method: action ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${getSetting("docs_api_key")}`,
      "Content-Type": "application/json",
    },
    ...(action ? { body: JSON.stringify(body ?? {}) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new DomainError(
      "DOCS_CHANGES_UNAVAILABLE",
      result?.error?.message ?? "Could not retrieve Docs changes.",
      response.status === 409 ? 409 : 502,
    );
  if (!result?.data)
    throw new DomainError(
      "DOCS_CHANGES_UNAVAILABLE",
      "Docs returned an incomplete response.",
      502,
    );
  return result.data as T;
}

export async function getRunDocsChanges(
  runId: string,
): Promise<RunDocsChanges> {
  const run = runRepository.getRun(runId);
  if (!run) throw notFound("Run not found");
  const access = accessFor(runId);
  if (!access)
    return {
      recorded: false,
      closed: false,
      changes: [],
      runStatus: run.status,
    };
  return {
    ...(await requestDocs<Omit<RunDocsChanges, "runStatus">>(access, "")),
    runStatus: run.status,
  };
}

export async function closeRunDocsAccess(runId: string) {
  const access = accessFor(runId);
  if (!access || access.closed_at) return;
  const run = runRepository.getRun(runId);
  if (!run || !terminal.has(run.status)) return;
  await requestDocs(access, "/close", {
    successful: run.status === "completed",
  });
  docsRunRepository.markClosed(runId);
}

export async function undoRunDocsChanges(
  runId: string,
  documentIds?: string[],
) {
  const run = runRepository.getRun(runId);
  if (!run) throw notFound("Run not found");
  if (!terminal.has(run.status))
    throw conflict(
      "Wait for the run to finish or stop it before undoing its changes.",
    );
  const access = accessFor(runId);
  if (!access) throw notFound("This run has no recorded Docs changes.");
  await closeRunDocsAccess(runId);
  const result = await requestDocs<Omit<RunDocsChanges, "runStatus">>(
    access,
    "/undo",
    documentIds ? { documentIds } : {},
  );
  runRepository.addRunEvent(runId, "docs_changes_undone", {
    documentIds: result.changes
      .filter((change) => change.undoneAt)
      .map((change) => change.documentId),
  });
  return { ...result, runStatus: run.status };
}

const state = globalThis as unknown as { slabClosingDocsRuns?: boolean };
export async function reviewRunDocsChanges(
  runId: string,
  action: "merge" | "reject",
) {
  const run = runRepository.getRun(runId);
  if (!run) throw notFound("Run not found");
  if (!terminal.has(run.status))
    throw conflict("Wait for the run to finish before reviewing its changes.");
  const access = accessFor(runId);
  if (!access) throw notFound("This run has no recorded Docs changes.");
  await closeRunDocsAccess(runId);
  const result = await requestDocs<Omit<RunDocsChanges, "runStatus">>(
    access,
    `/${action}`,
  );
  runRepository.addRunEvent(
    runId,
    `docs_changes_${action === "merge" ? "merged" : "rejected"}`,
    { commitId: result.commitId },
  );
  return { ...result, runStatus: run.status };
}

export async function reconcileDocsRunAccess() {
  if (state.slabClosingDocsRuns) return;
  state.slabClosingDocsRuns = true;
  try {
    const rows = docsRunRepository.pendingClosure();
    await Promise.allSettled(rows.map((row) => closeRunDocsAccess(row.run_id)));
  } finally {
    state.slabClosingDocsRuns = false;
  }
}
