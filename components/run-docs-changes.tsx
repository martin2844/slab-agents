"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileDiff, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocSnapshot, RunDocsChanges } from "@/lib/docs-run-changes";
import { documentLineDiff } from "@/lib/document-diff";

const terminal = new Set(["completed", "failed", "cancelled", "skipped"]);
export function SnapshotDiff({
  before,
  after,
}: {
  before: DocSnapshot | null;
  after: DocSnapshot;
}) {
  const fields = [
    ["Title", before?.title ?? "", after.title],
    ["Tags", before?.tags.join(", ") ?? "", after.tags.join(", ")],
    ["Parent", before?.parent_id ?? "None", after.parent_id ?? "None"],
    ["Collection", before?.collection_id ?? "None", after.collection_id],
    [
      "Visibility",
      before ? (before.archived_at ? "Archived" : "Active") : "Not created",
      after.archived_at ? "Archived" : "Active",
    ],
  ];
  const lines = documentLineDiff(before?.body ?? "", after.body);
  return (
    <div className="space-y-3">
      {fields.some(([, oldValue, newValue]) => oldValue !== newValue) && (
        <dl className="divide-y rounded-md border text-sm">
          {fields
            .filter(([, oldValue, newValue]) => oldValue !== newValue)
            .map(([label, oldValue, newValue]) => (
              <div
                key={label}
                className="grid gap-1 p-3 sm:grid-cols-[7rem_1fr_1fr]"
              >
                <dt className="font-medium">{label}</dt>
                <dd className="break-words text-red-800 dark:text-red-300">
                  <span className="sr-only">Before: </span>
                  {oldValue || "Empty"}
                </dd>
                <dd className="break-words text-emerald-800 dark:text-emerald-300">
                  <span className="sr-only">After: </span>
                  {newValue || "Empty"}
                </dd>
              </div>
            ))}
        </dl>
      )}
      {before?.body !== after.body && (
        <div
          className="max-h-[32rem] overflow-auto rounded-md border bg-background font-mono text-xs"
          aria-label="Document content diff"
        >
          {lines.map((line, index) => (
            <div
              key={index}
              className={`flex min-w-0 ${line.kind === "added" ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200" : line.kind === "removed" ? "bg-red-500/10 text-red-900 dark:text-red-200" : "text-muted-foreground"}`}
            >
              <span
                className="w-7 shrink-0 select-none border-r px-2 py-0.5"
                aria-label={
                  line.kind === "added"
                    ? "Added"
                    : line.kind === "removed"
                      ? "Removed"
                      : "Unchanged"
                }
              >
                {line.kind === "added"
                  ? "+"
                  : line.kind === "removed"
                    ? "−"
                    : " "}
              </span>
              <pre className="min-w-0 whitespace-pre-wrap break-words px-3 py-0.5">
                {line.text || " "}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RunDocsChangesPanel({
  runId,
  onPublished,
}: {
  runId: string;
  onPublished?: () => void;
}) {
  const [data, setData] = useState<RunDocsChanges | null>(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (busyRef.current) return;
      const requestGeneration = ++generation.current;
      const response = await fetch(`/api/runs/${runId}/docs-changes`, {
        signal,
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ?? "Could not load Docs changes.",
        );
      if (!signal?.aborted && requestGeneration === generation.current) {
        setData(result.data);
        setReadError("");
      }
    },
    [runId],
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      void refresh(controller.signal).catch((error) => {
        if (!controller.signal.aborted) setReadError(error.message);
      });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  async function undo(
    documentIds?: string[],
    action: "undo" | "merge" | "reject" = "undo",
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/runs/${runId}/docs-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(documentIds ? { documentIds } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ?? "Could not undo these changes.",
        );
      setData(result.data);
      if (action !== "reject") onPublished?.();
      setNotice(
        action === "merge"
          ? "Changes merged and published as one commit."
          : action === "reject"
            ? "Changes rejected. Published documents were not changed."
            : "Changes undone. The previous versions remain in document history.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not undo these changes.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      void refresh().catch(() => {});
    }
  }
  const stopped = !!data && terminal.has(data.runStatus);
  const draft =
    !!data?.editingMode &&
    data.editingMode !== "direct" &&
    data.state !== "merged";
  const pending = data?.state === "pending";
  const remaining = data?.changes.filter((change) => !change.undoneAt) ?? [];
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileDiff className="size-4" />
            Docs changes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {draft
              ? "These changes are saved as a private draft. Published documents stay unchanged until merge."
              : "Review the changes this run made to your documents."}
          </p>
        </div>
        {!!remaining.length && !draft && (
          <Button
            variant="outline"
            disabled={
              busy || !stopped || remaining.some((change) => !!change.conflict)
            }
            onClick={() => void undo()}
          >
            <RotateCcw />
            Undo all changes
          </Button>
        )}
      </div>
      {draft && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            {pending
              ? "Ready for review"
              : data?.state === "rejected"
                ? "Changes rejected"
                : data?.state === "empty"
                  ? "No document changes"
                  : "Agent is preparing changes"}
          </p>
          {data?.state === "editing" && (
            <p>
              {data.editingMode === "auto"
                ? "Changes will publish together after the run completes successfully."
                : "When the run finishes, review the complete diff and approve it once."}
            </p>
          )}
          {pending && (
            <>
              <p>
                The run has finished. Review the documents below, then approve
                or reject the whole set.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy ||
                    !stopped ||
                    remaining.some((change) => !!change.conflict)
                  }
                  onClick={() => void undo(undefined, "merge")}
                >
                  {busy ? "Saving…" : "Approve & merge"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !stopped}
                  onClick={() => void undo(undefined, "reject")}
                >
                  Reject changes
                </Button>
              </div>
            </>
          )}
          {data?.mergeError && pending && (
            <p role="alert" className="text-amber-800 dark:text-amber-300">
              {data.mergeError} Ask the agent to prepare an updated proposal
              using the current documents.
            </p>
          )}
        </div>
      )}
      {(error || readError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || readError}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {!data && !error && !readError && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading changes…
        </p>
      )}
      {data && !data.recorded && (
        <p className="text-sm text-muted-foreground">
          No change record is available for this run. Runs started before change
          tracking was enabled cannot be undone here.
        </p>
      )}
      {data?.recorded && !data.changes.length && (
        <p className="text-sm text-muted-foreground">
          This run has not changed any documents.
        </p>
      )}
      {!!data?.changes.length && !stopped && !draft && (
        <p className="text-sm text-muted-foreground">
          Changes appear as the agent works. You can undo them once the run
          finishes or is stopped.
        </p>
      )}
      {data?.changes.map((change) => (
        <details
          key={change.documentId}
          className="rounded-md border"
          open={data.changes.length === 1}
        >
          <summary className="cursor-pointer px-3 py-3 text-sm font-medium">
            {change.after.title}
            <span className="ml-2 font-normal text-muted-foreground">
              {change.undoneAt
                ? "Undone"
                : !change.before
                  ? "Created"
                  : change.after.archived_at && !change.before.archived_at
                    ? "Archived"
                    : "Updated"}
            </span>
          </summary>
          <div className="space-y-3 border-t p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {(!draft || change.before) && (
                <Link
                  className="text-xs underline"
                  href={`/docs?doc=${change.documentId}`}
                >
                  Open published document
                </Link>
              )}
              {!change.undoneAt && !draft && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !stopped || !!change.conflict}
                  onClick={() => void undo([change.documentId])}
                >
                  <RotateCcw />
                  Undo document
                </Button>
              )}
            </div>
            {change.conflict && (
              <p
                role="status"
                className="text-sm text-amber-800 dark:text-amber-300"
              >
                {change.conflict}
              </p>
            )}
            {change.interleaved ? (
              change.operations.map((operation, index) => (
                <div key={index} className="space-y-2">
                  <p className="text-xs font-medium">Edit {index + 1}</p>
                  <SnapshotDiff {...operation} />
                </div>
              ))
            ) : (
              <SnapshotDiff before={change.before} after={change.after} />
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
