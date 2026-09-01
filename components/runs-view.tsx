"use client";

import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
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
import { ApprovalActionDetails } from "@/components/approval-action-details";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/client-api";
import type { Approval, Run, RunsData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { approvalCanBeApproved } from "@/lib/approval-presentation";
import { groupRunHistory } from "@/lib/run-history";

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

function totalDuration(runs: Run[]) {
  if (runs.some((run) => run.startedAt && !run.completedAt)) return "Running";
  const milliseconds = runs.reduce((total, run) => {
    if (!run.startedAt || !run.completedAt) return total;
    return (
      total +
      Math.max(
        0,
        new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(),
      )
    );
  }, 0);
  if (!milliseconds) return "—";
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s total`
    : `${seconds}s total`;
}

function sharedRunValue(runs: Run[], value: (run: Run) => string) {
  const values = new Set(runs.map(value));
  return values.size === 1 ? value(runs[0]!) : "Mixed";
}

export function RunsView({ initialData }: { initialData: RunsData }) {
  const [data, setData] = useState<RunsData | null>(initialData);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedConversations, setExpandedConversations] = useState(
    () => new Set<string>(),
  );
  const loadGeneration = useRef(0);
  const load = async () => {
    const generation = ++loadGeneration.current;
    try {
      const next = await api<Partial<RunsData>>("/api/runs?activity=1");
      if (generation !== loadGeneration.current) return;
      setData((current) => {
        const previous = current ?? initialData;
        return {
          runs: next.runs
            ? [
                ...next.runs,
                ...previous.runs.filter(
                  (run) => !next.runs?.some((fresh) => fresh.id === run.id),
                ),
              ].slice(0, 100)
            : previous.runs,
          approvals: next.approvals ?? previous.approvals,
          agents: next.agents ?? previous.agents,
          conversations: next.conversations
            ? [
                ...next.conversations,
                ...previous.conversations.filter(
                  (conversation) =>
                    !next.conversations?.some(
                      (fresh) => fresh.id === conversation.id,
                    ),
                ),
              ]
            : previous.conversations,
        };
      });
      setError("");
    } catch (cause) {
      if (generation === loadGeneration.current) {
        setError(
          cause instanceof Error ? cause.message : "Could not load runs",
        );
      }
    }
  };
  useOperationalPolling(load);

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
  const conversations = data?.conversations ?? [];
  const history = groupRunHistory(runs);
  const conversationCount = history.filter(
    (entry) => entry.kind === "conversation",
  ).length;
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
  const conversationTitle = (threadId: string) =>
    conversations.find((conversation) => conversation.id === threadId)?.title ??
    `Chat ${threadId.slice(0, 8)}`;
  const toggleConversation = (threadId: string) => {
    setExpandedConversations((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

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
                        <ApprovalActionDetails approval={approval} />
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
                          disabled={
                            resolvingId === approval.id ||
                            !approvalCanBeApproved(approval.details)
                          }
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
              meta={`${runs.length} executions · ${conversationCount} conversation${conversationCount === 1 ? "" : "s"}`}
            />
            {!runs.length ? (
              <EmptyState
                title="No runs yet"
                description="Runs appear when an agent receives a task, chat message, or automation."
              />
            ) : (
              <>
                <div className="divide-y rounded-lg border bg-card md:hidden">
                  {history.map((entry) => {
                    if (entry.kind === "run") {
                      const { run } = entry;
                      return (
                        <Link
                          key={entry.key}
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
                            <p className="mt-1 font-mono">
                              {run.id.slice(0, 8)}
                            </p>
                          </div>
                        </Link>
                      );
                    }

                    const expanded = expandedConversations.has(entry.threadId);
                    const failed = entry.runs.filter(
                      (run) => run.status === "failed",
                    ).length;
                    return (
                      <div key={entry.key}>
                        <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate font-medium">
                                {conversationTitle(entry.threadId)}
                              </span>
                              <StatusBadge status={entry.status} />
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {agentName(entry.summaryRun.agentId)} ·{" "}
                              {entry.runs.length} run
                              {entry.runs.length === 1 ? "" : "s"} ·{" "}
                              {sharedRunValue(entry.runs, (run) => run.runtime)}
                              {failed ? ` · ${failed} failed` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button asChild size="icon-sm" variant="ghost">
                              <Link
                                href={`/agents/${entry.summaryRun.agentId}/threads/${entry.threadId}`}
                                aria-label={`Open conversation ${conversationTitle(entry.threadId)}`}
                              >
                                <MessageSquare />
                              </Link>
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? "Hide" : "Show"} runs for ${conversationTitle(entry.threadId)}`}
                              onClick={() => toggleConversation(entry.threadId)}
                            >
                              {expanded ? <ChevronDown /> : <ChevronRight />}
                            </Button>
                          </div>
                        </div>
                        {expanded ? (
                          <div className="divide-y border-t bg-muted/20">
                            {entry.runs.map((run) => (
                              <Link
                                key={run.id}
                                href={`/runs/${run.id}`}
                                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 pl-8 pr-3 hover:bg-muted/35"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-medium">
                                      {run.id.slice(0, 12)}
                                    </span>
                                    <StatusBadge status={run.status} />
                                  </div>
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {run.runtime} · {run.model}
                                  </p>
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                  <p>{duration(run)}</p>
                                  <p className="mt-1">
                                    {run.startedAt
                                      ? formatDateTime(run.startedAt)
                                      : "Queued"}
                                  </p>
                                </div>
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <DenseTable minWidth="1040px" className="hidden md:block">
                  <thead>
                    <tr>
                      <th className={denseTableHead}>Run / conversation</th>
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
                    {history.map((entry) => {
                      if (entry.kind === "run") {
                        const { run } = entry;
                        return (
                          <tr
                            key={entry.key}
                            className="group hover:bg-muted/25"
                          >
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
                            <td
                              className={`${denseTableCell} text-xs capitalize`}
                            >
                              {run.mode.replaceAll("_", " ")}{" "}
                              <span className="text-muted-foreground">
                                · {run.trigger.replaceAll("_", " ")}
                              </span>
                            </td>
                            <td
                              className={`${denseTableCell} font-mono text-xs`}
                            >
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
                                  <Button
                                    asChild
                                    size="icon-sm"
                                    variant="ghost"
                                  >
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
                        );
                      }

                      const expanded = expandedConversations.has(
                        entry.threadId,
                      );
                      const failed = entry.runs.filter(
                        (run) => run.status === "failed",
                      ).length;
                      const runtime = sharedRunValue(
                        entry.runs,
                        (run) => run.runtime,
                      );
                      const model = sharedRunValue(
                        entry.runs,
                        (run) => run.model,
                      );
                      return (
                        <Fragment key={entry.key}>
                          <tr className="group bg-muted/[0.16] hover:bg-muted/30">
                            <td className={denseTableCell}>
                              <div className="flex min-w-0 items-center gap-2">
                                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="max-w-56 truncate font-medium">
                                  {conversationTitle(entry.threadId)}
                                </span>
                                <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                                  {entry.runs.length} run
                                  {entry.runs.length === 1 ? "" : "s"}
                                </span>
                              </div>
                            </td>
                            <td className={`${denseTableCell} font-medium`}>
                              {agentName(entry.summaryRun.agentId)}
                            </td>
                            <td className={denseTableCell}>
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={entry.status} />
                                {failed && entry.status !== "failed" ? (
                                  <span className="text-xs text-destructive">
                                    {failed} failed
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className={`${denseTableCell} text-xs`}>
                              chat{" "}
                              <span className="text-muted-foreground">
                                · conversation
                              </span>
                            </td>
                            <td
                              className={`${denseTableCell} font-mono text-xs`}
                            >
                              —
                            </td>
                            <td className={`${denseTableCell} text-xs`}>
                              <span className="font-medium">{runtime}</span>
                              <span className="block max-w-36 truncate text-muted-foreground">
                                {model}
                              </span>
                            </td>
                            <td
                              className={`${denseTableCell} text-xs text-muted-foreground`}
                            >
                              {totalDuration(entry.runs)}
                            </td>
                            <td
                              className={`${denseTableCell} text-xs text-muted-foreground`}
                            >
                              {entry.summaryRun.startedAt
                                ? formatDateTime(entry.summaryRun.startedAt)
                                : "Queued"}
                            </td>
                            <td className={denseTableCell}>
                              <div className="flex justify-end gap-1">
                                <Button asChild size="icon-sm" variant="ghost">
                                  <Link
                                    href={`/agents/${entry.summaryRun.agentId}/threads/${entry.threadId}`}
                                    aria-label={`Open conversation ${conversationTitle(entry.threadId)}`}
                                  >
                                    <MessageSquare />
                                  </Link>
                                </Button>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? "Hide" : "Show"} runs for ${conversationTitle(entry.threadId)}`}
                                  onClick={() =>
                                    toggleConversation(entry.threadId)
                                  }
                                >
                                  {expanded ? (
                                    <ChevronDown />
                                  ) : (
                                    <ChevronRight />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {expanded
                            ? entry.runs.map((run) => (
                                <tr
                                  key={run.id}
                                  className="bg-muted/[0.08] hover:bg-muted/25"
                                >
                                  <td
                                    className={`${denseTableCell} pl-8 font-mono text-xs font-medium`}
                                  >
                                    <Link
                                      href={`/runs/${run.id}`}
                                      className="hover:text-primary"
                                    >
                                      {run.id.slice(0, 12)}
                                    </Link>
                                  </td>
                                  <td
                                    className={`${denseTableCell} text-xs text-muted-foreground`}
                                  >
                                    chat turn
                                  </td>
                                  <td className={denseTableCell}>
                                    <StatusBadge status={run.status} />
                                  </td>
                                  <td
                                    className={`${denseTableCell} text-xs text-muted-foreground`}
                                  >
                                    chat · chat
                                  </td>
                                  <td
                                    className={`${denseTableCell} font-mono text-xs`}
                                  >
                                    —
                                  </td>
                                  <td className={`${denseTableCell} text-xs`}>
                                    <span className="font-medium">
                                      {run.runtime}
                                    </span>
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
                                    <div className="flex justify-end">
                                      <Button
                                        asChild
                                        size="icon-sm"
                                        variant="ghost"
                                      >
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
                              ))
                            : null}
                        </Fragment>
                      );
                    })}
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
