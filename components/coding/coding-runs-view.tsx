"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Settings } from "lucide-react";
import {
  DenseTable,
  denseTableCell,
  denseTableHead,
} from "@/components/operational-ui";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { StartCodingRunDialog } from "@/components/coding/start-coding-run-dialog";
import {
  Elapsed,
  formatCost,
  STAGE_ICONS,
  StageStatusDot,
  stageTone,
} from "@/components/coding/coding-ui";
import { api } from "@/lib/client-api";
import { PIPELINE_STAGES, RUN_STATUS_LABELS, STAGE_DEFINITIONS, runBadgeStatus } from "@/lib/coding/stages";
import type { CodeRunSummary } from "@/lib/coding/types";
import { cn, formatDateTime } from "@/lib/utils";

type Filter = "open" | "waiting" | "finished" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "open", label: "Open" },
  { key: "waiting", label: "Waiting for you" },
  { key: "finished", label: "Finished" },
  { key: "all", label: "All" },
];

function matches(run: CodeRunSummary, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "waiting") return run.status === "waiting";
  if (filter === "open") return ["preparing", "active", "waiting"].includes(run.status);
  return ["done", "failed", "cancelled"].includes(run.status);
}

function MiniStrip({ run }: { run: CodeRunSummary }) {
  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STAGES.map((stage) => {
        const current = run.stages.find((item) => item.stage === stage);
        const Icon = STAGE_ICONS[stage];
        const status = current?.status ?? "pending";
        return (
          <span
            key={stage}
            title={`${STAGE_DEFINITIONS[stage].name}: ${status.replaceAll("_", " ")}`}
            className={cn(
              "relative grid size-6 place-items-center rounded-full border bg-card",
              stageTone(status),
              run.currentStage === stage && run.status !== "done" && "ring-2 ring-accent/40",
            )}
          >
            <Icon className="size-3" />
            <StageStatusDot status={status} className="size-2.5" />
          </span>
        );
      })}
    </div>
  );
}

export function CodingRunsView({ initialRuns }: { initialRuns: CodeRunSummary[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [filter, setFilter] = useState<Filter>("open");
  useOperationalPolling(async () => {
    setRuns(await api<CodeRunSummary[]>("/api/coding/runs"));
  }, 4_000);
  const visible = runs.filter((run) => matches(run, filter));

  return (
    <div>
      <PageHeader
        eyebrow="Operate"
        title="Coding"
        description="Coding runs turn Work items into reviewed pull requests: PM, tech spec, plan review, engineer, code review, and final pass."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/coding/settings">
                <Settings />
                Settings
              </Link>
            </Button>
            <StartCodingRunDialog
              trigger={
                <Button size="sm">
                  <Plus />
                  New coding run
                </Button>
              }
            />
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((item) => {
          const count = runs.filter((run) => matches(run, item.key)).length;
          return (
            <Button
              key={item.key}
              size="sm"
              variant={filter === item.key ? "default" : "outline"}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span className="font-mono text-xs opacity-70">{count}</span>
            </Button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <EmptyState
          title={runs.length ? "No runs match this filter" : "No coding runs yet"}
          description="Open a Work item and choose Start coding run, or use New coding run."
        />
      ) : (
        <DenseTable minWidth="980px">
          <thead>
            <tr>
              <th className={denseTableHead}>#</th>
              <th className={denseTableHead}>Work item</th>
              <th className={denseTableHead}>Repository</th>
              <th className={denseTableHead}>Stages</th>
              <th className={denseTableHead}>Status</th>
              <th className={denseTableHead}>Pull request</th>
              <th className={cn(denseTableHead, "text-right")}>Cost</th>
              <th className={cn(denseTableHead, "text-right")}>Elapsed</th>
              <th className={denseTableHead}>Started</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((run) => (
              <tr key={run.id} className="hover:bg-muted/40">
                <td className={cn(denseTableCell, "font-mono text-xs")}>
                  <Link className="hover:underline" href={`/coding/${run.number}`}>
                    #{run.number}
                  </Link>
                </td>
                <td className={cn(denseTableCell, "max-w-80")}>
                  <Link href={`/coding/${run.number}`} className="block truncate hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{run.issueKey}</span>{" "}
                    {run.title}
                  </Link>
                </td>
                <td className={cn(denseTableCell, "font-mono text-xs")}>
                  {run.repositories.map((item) => (
                    <div key={item.id} className="truncate">{item.fullName}</div>
                  ))}
                </td>
                <td className={denseTableCell}>
                  <MiniStrip run={run} />
                </td>
                <td className={denseTableCell}>
                  <div className="flex flex-col gap-0.5">
                    <StatusBadge status={runBadgeStatus(run, run.stages)} />
                    <span className="text-xs text-muted-foreground">
                      {run.status === "done"
                        ? RUN_STATUS_LABELS.done
                        : STAGE_DEFINITIONS[run.currentStage].name}
                    </span>
                  </div>
                </td>
                <td className={denseTableCell}>
                  {run.repositories.some((item) => item.prUrl) ? (
                    <div className="flex flex-col gap-0.5">
                      {run.repositories.filter((item) => item.prUrl).map((item) => (
                        <a key={item.id} href={item.prUrl!} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs hover:underline">
                          {run.repositories.length > 1 ? `${item.name}#${item.prNumber}` : `#${item.prNumber}`}
                          {item.prState && <StatusBadge status={item.prState === "merged" ? "done" : item.prState} />}
                          {item.ciState && item.ciState !== "none" && (
                            <span className={cn("font-mono", item.ciState === "failure" ? "text-destructive" : item.ciState === "success" ? "text-emerald-700" : "text-amber-700")}>
                              CI {item.ciState}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn(denseTableCell, "text-right font-mono text-xs")}>{formatCost(run.costUsd)}</td>
                <td className={cn(denseTableCell, "text-right font-mono text-xs")}>
                  <Elapsed start={run.startedAt} end={run.finishedAt} />
                </td>
                <td className={cn(denseTableCell, "text-xs text-muted-foreground")}>{formatDateTime(run.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}
    </div>
  );
}
