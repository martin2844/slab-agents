"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  MessageSquare,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DenseTable,
  SectionHeader,
  denseTableCell,
  denseTableHead,
} from "@/components/operational-ui";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/client-api";
import type { Approval, Run, RunsData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

function duration(run: Run) {
  if (!run.startedAt) return "—";
  if (!run.completedAt) return "Running";
  const ms =
    new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

export function RunsView({ initialData }: { initialData: RunsData }) {
  const [data, setData] = useState<RunsData | null>(initialData);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const load = () =>
    api<Partial<RunsData>>("/api/runs")
      .then((next) =>
        setData((current) => {
          const previous = current ?? initialData;
          return {
            runs: next.runs ?? previous.runs,
            approvals: next.approvals ?? previous.approvals,
            agents: next.agents ?? previous.agents,
          };
        }),
      )
      .catch((cause) => setError(cause.message));

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
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not resolve approval",
      );
    } finally {
      setResolvingId(null);
    }
  }

  const runs = data?.runs ?? [];
  const approvals = data?.approvals ?? [];
  const agents = data?.agents ?? [];
  const pending = approvals.filter((approval) => approval.status === "pending");
  const active = runs.filter((run) =>
    ["running", "queued", "waiting_approval"].includes(run.status),
  ).length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const agentName = (agentId: string) =>
    agents.find((agent) => agent.id === agentId)?.name ?? agentId.slice(0, 8);
  const chatHref = (run: Run) =>
    run.threadId
      ? `/agents/${run.agentId}/threads/${run.threadId}?run=${run.id}`
      : null;

  return (
    <>
      <PageHeader
        title="Runs"
        description={`${active} active · ${pending.length} waiting approval · ${failed} failed`}
      />
      {error && <ErrorState message={error} />}
      {!data && !error && <LoadingState />}
      {data && (
        <div className="space-y-5">
          {pending.length > 0 && (
            <section className="rounded-lg border border-amber-700/25 bg-amber-500/[0.055] p-4">
              <SectionHeader
                title="Waiting for you"
                meta={`${pending.length} approval${pending.length === 1 ? "" : "s"}`}
                action={<ShieldAlert className="size-4 text-amber-800" />}
              />
              <div className="divide-y border-y border-amber-800/15">
                {pending.map((approval) => {
                  const run = runs.find((item) => item.id === approval.runId);
                  const href = run ? chatHref(run) : null;
                  return (
                    <div
                      key={approval.id}
                      className="grid min-h-14 gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">
                          {approval.command}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Run {approval.runId.slice(0, 12)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {href && (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={href}>
                              <MessageSquare /> Open chat
                            </Link>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={resolvingId === approval.id}
                          onClick={() => decide(approval.id, "approve")}
                        >
                          {resolvingId === approval.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolvingId === approval.id}
                          onClick={() => decide(approval.id, "deny")}
                        >
                          <X /> Deny
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <SectionHeader
              title="Execution history"
              meta={`${runs.length} runs`}
            />
            {!runs.length ? (
              <EmptyState
                title="No runs yet"
                description="Runs appear when an agent receives a task, chat message, or automation."
              />
            ) : (
              <>
                <div className="divide-y rounded-lg border bg-card md:hidden">
                  {runs.map((run) => (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}`}
                      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-muted/25"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">
                            {agentName(run.agentId)}
                            {run.issueKey ? ` · ${run.issueKey}` : ""}
                          </span>
                          <StatusBadge status={run.status} />
                        </div>
                        <p className="mt-1 truncate text-xs capitalize text-muted-foreground">
                          {run.mode.replaceAll("_", " ")} ·{" "}
                          {run.trigger.replaceAll("_", " ")} · {run.runtime}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{duration(run)}</p>
                        <p className="mt-1 font-mono">{run.id.slice(0, 8)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
                <DenseTable minWidth="1040px" className="hidden md:block">
                  <thead>
                    <tr>
                      <th className={denseTableHead}>Run</th>
                      <th className={denseTableHead}>Agent</th>
                      <th className={denseTableHead}>Status</th>
                      <th className={denseTableHead}>Mode / trigger</th>
                      <th className={denseTableHead}>Issue</th>
                      <th className={denseTableHead}>Runtime</th>
                      <th className={denseTableHead}>Duration</th>
                      <th className={denseTableHead}>Started</th>
                      <th className={`${denseTableHead} w-20`}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className="group hover:bg-muted/25">
                        <td
                          className={`${denseTableCell} font-mono text-xs font-medium`}
                        >
                          <Link
                            href={`/runs/${run.id}`}
                            className="hover:text-primary"
                          >
                            {run.id.slice(0, 12)}
                          </Link>
                        </td>
                        <td className={`${denseTableCell} font-medium`}>
                          {agentName(run.agentId)}
                        </td>
                        <td className={denseTableCell}>
                          <StatusBadge status={run.status} />
                        </td>
                        <td className={`${denseTableCell} text-xs capitalize`}>
                          {run.mode.replaceAll("_", " ")}{" "}
                          <span className="text-muted-foreground">
                            · {run.trigger.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className={`${denseTableCell} font-mono text-xs`}>
                          {run.issueKey ?? "—"}
                        </td>
                        <td className={`${denseTableCell} text-xs`}>
                          <span className="font-medium">{run.runtime}</span>
                          <span className="block max-w-36 truncate text-muted-foreground">
                            {run.model}
                          </span>
                        </td>
                        <td
                          className={`${denseTableCell} text-xs text-muted-foreground`}
                        >
                          {duration(run)}
                        </td>
                        <td
                          className={`${denseTableCell} text-xs text-muted-foreground`}
                        >
                          {run.startedAt
                            ? formatDateTime(run.startedAt)
                            : "Queued"}
                        </td>
                        <td className={denseTableCell}>
                          <div className="flex justify-end gap-1">
                            {chatHref(run) && (
                              <Button asChild size="icon-sm" variant="ghost">
                                <Link
                                  href={chatHref(run)!}
                                  aria-label={`Open chat for run ${run.id}`}
                                >
                                  <MessageSquare />
                                </Link>
                              </Button>
                            )}
                            <Button asChild size="icon-sm" variant="ghost">
                              <Link
                                href={`/runs/${run.id}`}
                                aria-label={`Open run ${run.id}`}
                              >
                                <ArrowUpRight />
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DenseTable>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
