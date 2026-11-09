"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GitCommitHorizontal, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  RunDocsChangesPanel,
  SnapshotDiff,
} from "@/components/run-docs-changes";
import { api } from "@/lib/client-api";
import { formatDateTime } from "@/lib/utils";
import type {
  DocsCommit,
  DocsCommitDetail,
  DocsProposal,
} from "@/lib/docs-history";

type HistoryData = { commits: DocsCommit[]; proposals: DocsProposal[] };
export function DocsHistory({
  documentId,
  onPublished,
  refreshKey = 0,
}: {
  documentId: string | null;
  onPublished: () => void;
  refreshKey?: number;
}) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<"all" | "document">("all");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<DocsCommitDetail | null>(null);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const generation = useRef(0);
  const selectedGeneration = useRef(0);
  const busyRef = useRef(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (busyRef.current) return;
      const ticket = ++generation.current;
      const query = new URLSearchParams({
        offset: String(offset),
        ...(scope === "document" && documentId ? { documentId } : {}),
      });
      const result = await api<HistoryData>(`/api/docs/history?${query}`, {
        signal,
      });
      if (!signal?.aborted && ticket === generation.current) {
        setData(result);
        setError("");
      }
    },
    [documentId, scope, offset],
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      void refresh(controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    load();
    const timer = setInterval(load, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, refreshKey]);
  async function selectCommit(id: string) {
    const ticket = ++selectedGeneration.current;
    setLoadingCommit(true);
    setSelected(null);
    setError("");
    setNotice("");
    try {
      const result = await api<DocsCommitDetail>(`/api/docs/history/${id}`);
      if (ticket === selectedGeneration.current) setSelected(result);
    } catch (e) {
      if (ticket === selectedGeneration.current)
        setError(e instanceof Error ? e.message : "Could not load commit.");
    } finally {
      if (ticket === selectedGeneration.current) setLoadingCommit(false);
    }
  }
  async function revert() {
    if (!selected || busyRef.current) return;
    busyRef.current = true;
    generation.current++;
    selectedGeneration.current++;
    setBusy(true);
    setError("");
    try {
      await api(`/api/docs/history/${selected.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "revert" }),
      });
      setSelected(null);
      setNotice(
        "Reverted as a new commit. The original commit remains in history.",
      );
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revert commit.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      void refresh().catch((e) => setError(e.message));
    }
  }
  return (
    <section
      className="mb-4 space-y-3 rounded-lg border bg-card p-4"
      aria-label="Document history and proposed changes"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitCommitHorizontal className="size-4" /> Changes & history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every save is a commit. Review agent proposals here and restore
            earlier changes when needed.
          </p>
        </div>
        <Button variant="outline" onClick={() => setExpanded(!expanded)}>
          <History />
          {expanded ? "Hide history" : "View history"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {!!data?.proposals.length && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Waiting for review · {data.proposals.length}
          </h3>
          {data.proposals.map((proposal) => (
            <div
              key={proposal.run_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            >
              <div>
                <span className="font-medium">{proposal.author}</span> ·{" "}
                {proposal.documentCount} document
                {proposal.documentCount === 1 ? "" : "s"}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(proposal.closed_at)}
                  {proposal.merge_error
                    ? " · Conflict needs review"
                    : " · Not published yet"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setReview(review === proposal.run_id ? null : proposal.run_id)
                }
              >
                {review === proposal.run_id ? "Hide changes" : "Review changes"}
              </Button>
            </div>
          ))}
        </div>
      )}
      {review && (
        <RunDocsChangesPanel
          key={review}
          runId={review}
          onPublished={() => {
            onPublished();
            void refresh().catch((e) => setError(e.message));
          }}
        />
      )}
      {expanded && (
        <div className="space-y-4 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={scope === "all" ? "default" : "outline"}
              onClick={() => {
                setScope("all");
                setOffset(0);
              }}
            >
              All documents
            </Button>
            <Button
              size="sm"
              disabled={!documentId}
              variant={scope === "document" ? "default" : "outline"}
              onClick={() => {
                setScope("document");
                setOffset(0);
              }}
            >
              Selected document
            </Button>
          </div>
          {!data ? (
            <p className="text-sm text-muted-foreground">Loading history…</p>
          ) : !data.commits.length ? (
            <p className="text-sm text-muted-foreground">
              No commits on this page. Earlier text revisions remain available
              in the document’s revision menu.
            </p>
          ) : (
            <ol className="divide-y rounded-md border">
              {data.commits.map((commit) => (
                <li key={commit.id}>
                  <button
                    disabled={busy}
                    onClick={() => void selectCommit(commit.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-muted/50 ${selected?.id === commit.id ? "bg-muted" : ""}`}
                  >
                    <span>
                      <span className="font-medium">{commit.message}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {commit.author} · {formatDateTime(commit.created_at)} ·{" "}
                        {commit.documentCount} document
                        {commit.documentCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <code className="text-xs text-muted-foreground">
                      {commit.id.slice(0, 8)}
                    </code>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Newer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(data?.commits.length ?? 0) < 50}
              onClick={() => setOffset(offset + 50)}
            >
              Older
            </Button>
          </div>
          {loadingCommit && (
            <p role="status" className="text-sm">
              Loading diff…
            </p>
          )}
          {selected && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{selected.message}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selected.author} · {formatDateTime(selected.created_at)}
                  </p>
                  {selected.run_id && (
                    <Link
                      href={`/runs/${selected.run_id}`}
                      className="text-xs underline"
                    >
                      View run
                    </Link>
                  )}
                </div>
                <Button
                  variant="outline"
                  disabled={
                    busy || selected.changes.some((change) => !!change.conflict)
                  }
                  onClick={() => void revert()}
                >
                  <RotateCcw />
                  {busy
                    ? "Reverting…"
                    : `Revert ${selected.changes.length} document${selected.changes.length === 1 ? "" : "s"}`}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Reverting restores this commit’s previous versions and creates a
                new commit.
              </p>
              {selected.changes.map((change) => (
                <details
                  key={change.documentId}
                  open={selected.changes.length === 1}
                  className="rounded-md border"
                >
                  <summary className="cursor-pointer p-3 text-sm font-medium">
                    {change.after.title}
                  </summary>
                  <div className="space-y-3 border-t p-3">
                    {change.conflict && (
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        {change.conflict}
                      </p>
                    )}
                    <SnapshotDiff before={change.before} after={change.after} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
