"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FileDiff } from "lucide-react";
import { api } from "@/lib/client-api";
import type { RunDocsChanges } from "@/lib/docs-run-changes";
export function DocsReviewNotice({ runId }: { runId: string }) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      void api<RunDocsChanges>(`/api/runs/${runId}/docs-changes`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted)
            setPending(data.state === "pending" ? data.changes.length : 0);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [runId]);
  if (!pending) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
    >
      <div>
        <p className="flex items-center gap-2 font-medium">
          <FileDiff className="size-4" />
          {pending} document{pending === 1 ? "" : "s"} ready for review
        </p>
        <p className="mt-1 text-muted-foreground">
          The agent has finished. These changes are saved but have not been
          published.
        </p>
      </div>
      <Link href="/docs" className="font-medium underline">
        Review & merge in Docs
      </Link>
    </div>
  );
}
