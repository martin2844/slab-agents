import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  PanelsTopLeft,
  Play,
  Plug,
} from "lucide-react";
import { OverviewKickstart } from "@/components/overview-kickstart";
import { MetricStrip, SectionHeader } from "@/components/operational-ui";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { OverviewData, Run } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

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
  if (seconds < 86_400) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `since ${formatDateTime(run.startedAt)}`;
}

export function OverviewDashboard({ data }: { data: OverviewData }) {
  const agentName = (id: string) =>
    data.agentsList.find((agent) => agent.id === id)?.name ?? id.slice(0, 8);
  const attentionTotal =
    data.attention.approvals +
    data.attention.failedRuns +
    data.attention.blockedWork +
    data.attention.reviewWork +
    data.attention.integrationIssues;

  return (
    <>
      <OverviewKickstart initialSetup={data.setup} agents={data.agentsList} />
      <div className="space-y-5">
        <MetricStrip
          items={[
            {
              label: "agents",
              value: data.agents.total,
              detail: `${data.agents.running} running · ${data.agents.queued} queued`,
              icon: Bot,
              tone: data.agents.running ? "running" : "default",
            },
            {
              label: "open work",
              value: data.work.connected ? data.work.open : "—",
              detail: `${data.work.blocked} blocked · ${data.work.review} review`,
              icon: PanelsTopLeft,
              tone: data.work.blocked ? "attention" : "default",
            },
            {
              label: "integrations",
              value: data.integrations.healthy,
              detail: `${data.integrations.total} configured · ${data.integrations.issues} issues`,
              icon: Plug,
            },
            {
              label: "automations",
              value: data.automations.length,
              detail: "active schedules",
              icon: CalendarClock,
            },
          ]}
        />

        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-lg border bg-card p-4">
            <SectionHeader
              title="Active now"
              meta={`${data.activeRuns.length} active executions`}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/runs">
                    View runs <ArrowUpRight />
                  </Link>
                </Button>
              }
            />
            <div className="divide-y border-y">
              {data.activeRuns.slice(0, 5).map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {agentName(run.agentId)}
                      </span>
                      <StatusBadge status={run.status} />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{runLabel(run)}</span> ·{" "}
                      {run.trigger.replaceAll("_", " ")} · {elapsed(run)}
                    </p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
              {!data.activeRuns.length && (
                <div className="flex min-h-28 items-center gap-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-5 text-emerald-700" />
                  No agents are running. The queue is clear.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <SectionHeader
              title="Needs attention"
              meta={`${attentionTotal} signals`}
            />
            <div className="divide-y border-y">
              {[
                ["Blocked work", data.attention.blockedWork, "/work"],
                ["Review requested", data.attention.reviewWork, "/work"],
                ["Waiting approvals", data.attention.approvals, "/runs"],
                ["Failed runs", data.attention.failedRuns, "/runs"],
                [
                  "Integration issues",
                  data.attention.integrationIssues,
                  "/integrations",
                ],
              ]
                .filter(([, value]) => Number(value) > 0)
                .map(([label, value, href]) => (
                  <Link
                    key={String(label)}
                    href={String(href)}
                    className="flex min-h-10 items-center justify-between gap-4 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5 text-amber-800" />
                      {label}
                    </span>
                    <strong className="font-mono">{value}</strong>
                  </Link>
                ))}
              {attentionTotal === 0 && (
                <div className="flex min-h-20 items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-700" /> No
                  exceptions need attention.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-lg border bg-card p-4">
            <SectionHeader
              title="Recent runs"
              meta="Latest execution history"
            />
            <div className="divide-y border-y">
              {data.recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
                >
                  <Play className="size-3.5 text-muted-foreground" />
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {agentName(run.agentId)} · {runLabel(run)}
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {run.startedAt ? formatDateTime(run.startedAt) : "Queued"}
                    </span>
                  </div>
                  <StatusBadge status={run.status} />
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <SectionHeader
              title="Next automations"
              meta={`${data.automations.length} active`}
            />
            <div className="divide-y border-y">
              {data.automations.slice(0, 5).map((item) => (
                <div key={item.id} className="flex min-h-12 items-center gap-3">
                  <CircleDot className="size-3.5 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
                      {item.cronExpression ?? "Manual"}
                    </p>
                  </div>
                  <Clock3 className="size-3.5 text-muted-foreground" />
                </div>
              ))}
              {!data.automations.length && (
                <p className="py-5 text-sm text-muted-foreground">
                  No active schedules.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
