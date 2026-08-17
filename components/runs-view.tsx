"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/client-api";
import type { Approval, RunsData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
export function RunsView({ initialData }: { initialData: RunsData }) {
  const [data, setData] = useState<RunsData | null>(initialData),
    [error, setError] = useState(""),
    [resolvingId, setResolvingId] = useState<string | null>(null);
  const load = () =>
    api<RunsData>("/api/runs")
      .then(setData)
      .catch((e) => setError(e.message));
  async function decide(id: string, decision: "approve" | "deny") {
    if (resolvingId) return;
    setResolvingId(id);
    try {
      const result = await api<Approval & { dismissed?: boolean }>(
        `/api/approvals/${id}`,
        {
          method: "POST",
          body: JSON.stringify({ decision }),
        },
      );
      if (result.dismissed) toast.info("Stale approval dismissed");
      else toast.success(decision === "approve" ? "Approved" : "Denied");
      await load();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not resolve approval",
      );
    } finally {
      setResolvingId(null);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Execution ledger"
        title="Runs"
        description="A compact history of agent execution, significant runtime events, failures, and approvals."
      />
      {error && <ErrorState message={error} />}{" "}
      {!data && !error && <LoadingState />}
      {data && (
        <div className="space-y-12">
          {data.approvals.some((a) => a.status === "pending") && (
            <section>
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-700" />
                <h2 className="font-heading text-3xl font-semibold">
                  Waiting for you
                </h2>
              </div>
              <div className="space-y-3">
                {data.approvals
                  .filter((a) => a.status === "pending")
                  .map((a) => (
                    <div
                      key={a.id}
                      className="grid gap-4 border border-amber-700/30 bg-amber-500/10 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          Agent wants to execute
                        </p>
                        <pre className="mt-2 overflow-auto font-mono text-xs">
                          {a.command}
                        </pre>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={resolvingId === a.id}
                          onClick={() => decide(a.id, "approve")}
                        >
                          {resolvingId === a.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolvingId === a.id}
                          onClick={() => decide(a.id, "deny")}
                        >
                          <X />
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-4 font-heading text-3xl font-semibold">
              History
            </h2>
            {!data.runs.length ? (
              <EmptyState
                title="No runs yet"
                description="Runs appear when an agent receives a chat message or an automation fires."
              />
            ) : (
              <div className="divide-y border-y">
                {data.runs.map((run) => (
                  <Link
                    href={`/runs/${run.id}`}
                    key={run.id}
                    className="group grid gap-4 py-5 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-mono text-sm font-semibold">
                        {run.id.slice(0, 16)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Agent {run.agentId.slice(0, 8)} ·{" "}
                        {run.mode.replaceAll("_", " ")} ·{" "}
                        {run.trigger.replaceAll("_", " ")}
                        {run.issueKey ? ` · ${run.issueKey}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={run.status} />
                    <p className="text-xs text-muted-foreground">
                      {run.startedAt ? formatDateTime(run.startedAt) : "Queued"}
                    </p>
                    <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
