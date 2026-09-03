"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  ListChecks,
  Play,
  ShieldAlert,
} from "lucide-react";
import { OverviewKickstart } from "@/components/overview-kickstart";
import { MetricStrip, SectionHeader } from "@/components/operational-ui";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { api } from "@/lib/client-api";
import type { Agent, OverviewData, Run } from "@/lib/types";
import {
  cn,
  formatDateTime,
  formatRelativeFuture,
  formatRelativePast,
} from "@/lib/utils";

function runLabel(run: Run) {
  if (run.issueKey) return run.issueKey;
  if (run.mode === "review") return "Operational review";
  if (run.mode === "chat") return "Conversation";
  return run.mode.replaceAll("_", " ");
}

function elapsed(run: Run) {
  if (!run.startedAt) return "Waiting in queue";
  const end = run.completedAt ? new Date(run.completedAt) : new Date();
  const seconds = Math.max(
    0,
    Math.floor((end.getTime() - new Date(run.startedAt).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 86_400) return `${Math.floor(seconds / 60)}m`;
  return formatDateTime(run.startedAt);
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("en", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function activityCopy(run: Run, agentName: string) {
  const subject = run.issueKey ? `“${run.issueKey}”` : runLabel(run);
  switch (run.status) {
    case "completed":
      return `${agentName} completed ${subject}`;
    case "failed":
      return `${agentName}'s ${subject} run failed`;
    case "skipped":
      return `${agentName}'s ${subject} run was skipped`;
    case "cancelled":
      return `${agentName}'s ${subject} run was cancelled`;
    case "waiting_approval":
      return `${agentName} requested approval for ${subject}`;
    case "running":
      return `${agentName} started ${subject}`;
    case "queued":
      return `${subject} was queued for ${agentName}`;
  }
}

function currentRunForAgent(agent: Agent, runs: Run[]) {
  return runs.find(
    (run) => run.agentId === agent.id && run.status === "running",
  );
}

function queuedRunsForAgent(agent: Agent, runs: Run[]) {
  return runs.filter(
    (run) =>
      run.agentId === agent.id &&
      (run.status === "queued" || run.status === "waiting_approval"),
  );
}

function agentActivityRank(agent: Agent, runs: Run[]) {
  if (runs.some((run) => run.agentId === agent.id && run.status === "running"))
    return 0;
  if (
    runs.some(
      (run) => run.agentId === agent.id && run.status === "waiting_approval",
    )
  )
    return 1;
  if (runs.some((run) => run.agentId === agent.id && run.status === "queued"))
    return 2;
  return 3;
}

export function OverviewDashboard({
  data: initialData,
}: {
  data: OverviewData;
}) {
  const [data, setData] = useState(initialData);
  useOperationalPolling(async () => {
    setData(await api<OverviewData>("/api/overview"));
  }, 5_000);

  const agentName = (id: string) =>
    data.agentsList.find((agent) => agent.id === id)?.name ?? id.slice(0, 8);
  const operationalAgents = data.agentsList
    .filter(
      (agent) =>
        agent.enabled || data.activeRuns.some((run) => run.agentId === agent.id),
    )
    .sort((left, right) => {
      const rankDifference =
        agentActivityRank(left, data.activeRuns) -
        agentActivityRank(right, data.activeRuns);
      if (rankDifference !== 0) return rankDifference;
      return left.name.localeCompare(right.name);
    });
  const attentionItems = [
    {
      label: "Work source unavailable",
      value: data.attention.workUnavailable ? 1 : 0,
      href: "/settings?section=connections",
    },
    {
      label: "Blocked work",
      value: data.attention.blockedWork,
      href: "/work#work-blocked",
    },
    {
      label: "Review requested",
      value: data.attention.reviewWork,
      href: "/work#work-review",
    },
    {
      label: "Approvals waiting",
      value: data.attention.approvals,
      href: "/runs",
    },
    {
      label: "Failed runs in 24h",
      value: data.attention.failedRuns,
      href: "/runs",
    },
    {
      label: "Integration issues",
      value: data.attention.integrationIssues,
      href: "/integrations",
    },
  ].filter((item) => item.value > 0);
  const attentionTotal = attentionItems.reduce(
    (total, item) => total + item.value,
    0,
  );
  const allUsageUnpriced =
    data.usageToday.totalTokens > 0 &&
    data.usageToday.unpricedTokens === data.usageToday.totalTokens;
  const pipeline = [
    {
      label: "Backlog",
      value: data.work.backlog,
      href: "/work#work-new",
    },
    {
      label: "Assigned",
      value: data.work.assigned,
      href: "/work#work-new",
    },
    {
      label: "In progress",
      value: data.work.inProgress,
      href: "/work#work-in_progress",
    },
    {
      label: "Review",
      value: data.work.review,
      href: "/work#work-review",
    },
    {
      label: "Blocked",
      value: data.work.blocked,
      href: "/work#work-blocked",
    },
  ];

  return (
    <>
      <OverviewKickstart
        setup={data.setup}
        agents={data.agentsList}
        healthyIntegrations={data.integrations.healthy}
        configuredIntegrations={data.integrations.total}
        onSetupChange={(setup) => setData((current) => ({ ...current, setup }))}
      />

      <div className="space-y-7">
        <section>
          <SectionHeader title="Company pulse" meta="Today" />
          <MetricStrip
            items={[
              {
                label: "agents",
                value: data.agents.total,
                detail: [
                  `${data.agents.running} working`,
                  data.agents.waitingApproval
                    ? `${data.agents.waitingApproval} waiting`
                    : null,
                  `${data.agents.idle} idle`,
                ]
                  .filter(Boolean)
                  .join(" · "),
                icon: Bot,
                tone: data.agents.running ? "running" : "default",
              },
              {
                label: "open work",
                value: data.work.connected ? data.work.open : "—",
                detail: data.work.connected
                  ? `${data.work.inProgress} in progress · ${data.work.blocked} blocked`
                  : "source unavailable",
                icon: ListChecks,
                tone: data.work.blocked ? "attention" : "default",
              },
              {
                label: "approvals",
                value: data.attention.approvals,
                detail: data.attention.approvals
                  ? "waiting for you"
                  : "nothing waiting",
                icon: ShieldAlert,
                tone: data.attention.approvals ? "attention" : "default",
              },
              {
                label: "spend today",
                value: !data.usageToday.available
                  ? "—"
                  : allUsageUnpriced
                    ? "Unpriced"
                    : formatUsd(data.usageToday.trackedUsd),
                detail: !data.usageToday.available
                  ? "usage unavailable"
                  : `${formatTokens(data.usageToday.totalTokens)} tokens${data.usageToday.unpricedTokens > 0 && !allUsageUnpriced ? ` · ${formatTokens(data.usageToday.unpricedTokens)} unpriced` : ""}`,
                icon: CircleDollarSign,
              },
            ]}
          />
        </section>

        <section>
          <SectionHeader title="Operations" meta="Current state" />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="rounded-lg border bg-card p-4">
              <SectionHeader
                title="Agents"
                meta={[
                  `${data.agents.running} working`,
                  data.agents.waitingApproval
                    ? `${data.agents.waitingApproval} waiting`
                    : null,
                  `${data.agents.queued} queued`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/agents">
                      View all <ArrowUpRight />
                    </Link>
                  </Button>
                }
              />
              <div className="divide-y border-y">
                {operationalAgents.slice(0, 4).map((agent) => {
                  const currentRun = currentRunForAgent(agent, data.activeRuns);
                  const queuedRuns = queuedRunsForAgent(agent, data.activeRuns);
                  const waitingApproval = queuedRuns.find(
                    (run) => run.status === "waiting_approval",
                  );
                  const focusRun =
                    currentRun ?? waitingApproval ?? queuedRuns[0];
                  const status = currentRun
                    ? "running"
                    : waitingApproval
                      ? "waiting_approval"
                      : queuedRuns.length
                        ? "queued"
                        : "idle";
                  return (
                    <Link
                      key={agent.id}
                      href={
                        focusRun
                          ? `/runs/${focusRun.id}`
                          : `/agents/${agent.id}`
                      }
                      className="grid min-h-14 gap-2 py-2.5 transition-colors hover:bg-muted/35 sm:grid-cols-[minmax(8rem,0.75fr)_minmax(0,1.4fr)_auto] sm:items-center sm:px-1"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-[650]">
                          {agent.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {agent.role}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {focusRun ? runLabel(focusRun) : "No assigned work"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {currentRun ? (
                            <>
                              {currentRun.mode.replaceAll("_", " ")} ·{" "}
                              <span suppressHydrationWarning>
                                {elapsed(currentRun)}
                              </span>
                            </>
                          ) : waitingApproval ? (
                            "Waiting for approval"
                          ) : queuedRuns.length ? (
                            `${queuedRuns.length} queued`
                          ) : (
                            "Ready for work"
                          )}
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </Link>
                  );
                })}
                {!operationalAgents.length && (
                  <div className="flex min-h-24 items-center justify-between gap-4 text-sm text-muted-foreground">
                    <span>No enabled agents yet.</span>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/agents/new">Create agent</Link>
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div
              className={cn(
                "rounded-lg border bg-card p-4",
                attentionTotal > 0 &&
                  "border-amber-700/25 bg-amber-500/[0.035]",
              )}
            >
              <SectionHeader
                title="Needs attention"
                meta={
                  attentionTotal ? `${attentionTotal} signals` : "All clear"
                }
              />
              <div className="divide-y border-y">
                {attentionItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex min-h-11 items-center justify-between gap-4 text-sm transition-colors hover:bg-background/65"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5 text-amber-800" />
                      {item.label}
                    </span>
                    <strong className="font-mono text-xs">{item.value}</strong>
                  </Link>
                ))}
                {!attentionItems.length && (
                  <div className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-success" />
                    Everything looks good.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader
            title="Work pipeline"
            meta={
              data.work.connected
                ? `${data.work.open} open`
                : "Source unavailable"
            }
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/work">
                  Open Work <ArrowUpRight />
                </Link>
              </Button>
            }
          />
          <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-5">
            {pipeline.map((stage, index) => (
              <Link
                key={stage.label}
                href={stage.href}
                className="group relative flex min-h-16 items-center justify-between gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/45 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <div>
                  <p className="font-mono text-lg font-medium tabular-nums">
                    {data.work.connected ? stage.value : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{stage.label}</p>
                </div>
                {index < pipeline.length - 1 && (
                  <ArrowRight className="size-3.5 text-border transition-colors group-hover:text-muted-foreground sm:absolute sm:-right-2 sm:z-10 sm:bg-card" />
                )}
              </Link>
            ))}
          </div>
        </section>

        <section>
          <SectionHeader
            title="Activity"
            meta="What happened and what comes next"
          />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="rounded-lg border bg-card p-4">
              <SectionHeader
                title="Recent activity"
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/runs">
                      View all runs <ArrowUpRight />
                    </Link>
                  </Button>
                }
              />
              <div className="divide-y border-y">
                {data.recentRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 transition-colors hover:bg-muted/35"
                  >
                    {run.status === "completed" ? (
                      <FileCheck2 className="size-3.5 text-success" />
                    ) : run.status === "failed" ? (
                      <AlertTriangle className="size-3.5 text-destructive" />
                    ) : (
                      <Play className="size-3.5 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {activityCopy(run, agentName(run.agentId))}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {run.trigger.replaceAll("_", " ")} ·{" "}
                        {run.mode.replaceAll("_", " ")}
                      </p>
                    </div>
                    <time
                      dateTime={
                        run.completedAt ?? run.startedAt ?? run.createdAt
                      }
                      suppressHydrationWarning
                      className="font-mono text-[0.68rem] text-muted-foreground"
                    >
                      {formatRelativePast(
                        run.completedAt ?? run.startedAt ?? run.createdAt,
                      )}
                    </time>
                  </Link>
                ))}
                {!data.recentRuns.length && (
                  <div className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="size-4" /> No activity yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <SectionHeader
                title="Upcoming automations"
                meta={`${data.upcomingAutomations.length} active`}
              />
              <div className="divide-y border-y">
                {data.upcomingAutomations.slice(0, 5).map((automation) => (
                  <Link
                    key={automation.id}
                    href="/automations"
                    className="flex min-h-12 items-center gap-3 transition-colors hover:bg-muted/35"
                  >
                    <CalendarClock className="size-3.5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {automation.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {automation.nextRunAt ? (
                          <span suppressHydrationWarning>
                            Next {formatRelativeFuture(automation.nextRunAt)}
                          </span>
                        ) : automation.triggerType === "email" ? (
                          "On matching email"
                        ) : (
                          "Schedule unavailable"
                        )}
                      </p>
                    </div>
                  </Link>
                ))}
                {!data.upcomingAutomations.length && (
                  <div className="flex min-h-16 items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>No upcoming automations.</span>
                    <Link
                      href="/automations"
                      className="font-medium text-foreground"
                    >
                      Create one <ArrowUpRight className="inline size-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
