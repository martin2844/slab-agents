import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CircleDot,
  PanelsTopLeft,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OverviewKickstart } from "@/components/overview-kickstart";
import { StatusBadge } from "@/components/status-badge";
import type { OverviewData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function OverviewDashboard({ data }: { data: OverviewData }) {
  return (
    <>
      <OverviewKickstart initialSetup={data.setup} agents={data.agentsList} />
      <div className="space-y-10">
        <section className="grid border-y sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Agents",
              value: data.agents.total,
              detail: `${data.agents.running} running · ${data.agents.idle} idle`,
              icon: Bot,
              href: "/agents",
            },
            {
              label: "Open work",
              value: data.work.connected ? data.work.open : "—",
              detail: data.work.connected
                ? `${data.work.inProgress} in progress · ${data.work.blocked} blocked`
                : "Work is offline",
              icon: PanelsTopLeft,
              href: "/work",
            },
            {
              label: "Automations",
              value: data.automations.length,
              detail: "active schedules",
              icon: CalendarClock,
              href: "/automations",
            },
            {
              label: "Needs attention",
              value: data.attention.approvals + data.attention.failedRuns,
              detail: `${data.attention.approvals} approvals · ${data.attention.failedRuns} failed`,
              icon: AlertTriangle,
              href: "/runs",
            },
          ].map((item, index) => (
            <Link
              href={item.href}
              key={item.label}
              className="group relative min-h-48 border-b p-5 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
            >
              <div className="flex items-start justify-between">
                <item.icon className="size-5 text-muted-foreground" />
                <ArrowUpRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-8 font-heading text-6xl font-semibold leading-none tracking-[-0.05em] tabular-nums">
                {item.value}
              </p>
              <p className="mt-3 text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.detail}
              </p>
              <span
                className="absolute left-0 top-0 h-1 bg-primary transition-all group-hover:w-full"
                style={{
                  width: index === 3 && Number(item.value) > 0 ? "100%" : "0",
                }}
              />
            </Link>
          ))}
        </section>
        <div className="grid gap-10 xl:grid-cols-[1.35fr_0.65fr]">
          <section>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
                  Activity
                </p>
                <h2 className="mt-1 font-heading text-3xl font-semibold tracking-tight">
                  Recent runs
                </h2>
              </div>
              <Button variant="ghost" asChild>
                <Link href="/runs">
                  View all <ArrowUpRight />
                </Link>
              </Button>
            </div>
            {data.recentRuns.length ? (
              <div className="divide-y border-y">
                {data.recentRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4"
                  >
                    <span className="grid size-9 place-items-center rounded-full bg-muted">
                      <Play className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        Run {run.id.slice(0, 8)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {run.startedAt
                          ? formatDateTime(run.startedAt)
                          : "Queued"}
                      </p>
                    </div>
                    <StatusBadge status={run.status} />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="border-y py-8 text-sm text-muted-foreground">
                Runs will appear after an agent receives a message.
              </p>
            )}
          </section>
          <section>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
              Next up
            </p>
            <h2 className="mt-1 font-heading text-3xl font-semibold tracking-tight">
              Automations
            </h2>
            <div className="mt-4 space-y-2">
              {data.automations.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 border-t py-4"
                >
                  <CircleDot className="mt-0.5 size-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{item.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {item.cronExpression ?? "Manual"}
                    </p>
                  </div>
                </div>
              ))}
              {!data.automations.length && (
                <p className="border-t py-5 text-sm text-muted-foreground">
                  No active schedules yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
