import Link from "next/link";
import {
  ArrowLeft,
  CircleDot,
  MessageSquare,
  Terminal,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  DenseTable,
  denseTableCell,
  denseTableHead,
} from "@/components/operational-ui";
import { StatusBadge } from "@/components/status-badge";
import { RunContextUsage } from "@/components/run-context-usage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RunDetailData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function RunDetail({ data }: { data: RunDetailData }) {
  const skipped = [...data.events]
    .reverse()
    .find((event) => event.type === "run_skipped");
  const budgetSkipped = skipped?.payload.reason === "budget_rejected";
  const budgetSkipReason = String(
    skipped?.payload.budgetReason ?? data.budget?.reason ?? "budget_rejected",
  ).replaceAll("_", " ");
  const runtimeStarted = data.events.some(
    (event) => event.type === "runner_run_started",
  );
  const runtimeSelection = [...data.events]
    .reverse()
    .find((event) => event.type === "runtime_thread_selected");
  const runtimeCompletion = [...data.events]
    .reverse()
    .find((event) => event.type === "run_completed");
  const runtimeCreated = [...data.events]
    .reverse()
    .find((event) => event.type === "thread_created");
  const runtimeThreadId =
    runtimeCompletion?.payload.runtimeThreadId ??
    runtimeCreated?.payload.runtimeThreadId ??
    runtimeSelection?.payload.runtimeThreadId ??
    null;
  const runtimeContinuity =
    runtimeCompletion?.payload.runtimeContinuity ??
    runtimeSelection?.payload.continuity ??
    null;
  const skipReason =
    data.run.trigger === "blocked"
      ? "Trigger is stale. The issue is no longer blocked."
      : data.run.trigger === "assignment"
        ? "Trigger is stale. The issue is no longer assigned to this agent or no longer requires assignment work."
        : "The Work condition that created this run is no longer current.";

  return (
    <>
      <PageHeader
        title={`Run ${data.run.id.slice(0, 12)}`}
        description={`${data.run.mode.replaceAll("_", " ")} · ${data.run.trigger.replaceAll("_", " ")}${data.run.issueKey ? ` · ${data.run.issueKey}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {data.run.threadId && (
              <Button variant="outline" asChild>
                <Link
                  href={`/agents/${data.run.agentId}/threads/${data.run.threadId}?run=${data.run.id}`}
                >
                  <MessageSquare /> Open chat
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/runs">
                <ArrowLeft /> All runs
              </Link>
            </Button>
          </div>
        }
      />
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-lg border bg-card p-1 sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="context">Context / Usage</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="debug">Debug</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Status", <StatusBadge key="status" status={data.run.status} />],
              ["Mode", data.run.mode.replaceAll("_", " ")],
              ["Trigger", data.run.trigger.replaceAll("_", " ")],
              ["Issue", data.run.issueKey ?? "None"],
              [
                "Runtime",
                `${data.run.runtime} / ${data.run.model} · ${runtimeContinuity ?? "fresh"}`,
              ],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="min-h-20 border-b p-3 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
              >
                <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.02em] text-muted-foreground">
                  {label}
                </p>
                <div className="mt-2 text-sm font-semibold capitalize">
                  {value}
                </div>
              </div>
            ))}
          </section>
          <section className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Execution</h2>
              <dl className="mt-3 divide-y border-y text-sm">
                <div className="grid min-h-11 grid-cols-[10rem_1fr] items-center gap-3">
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>
                    {data.run.startedAt
                      ? formatDateTime(data.run.startedAt)
                      : "Not started"}
                  </dd>
                </div>
                <div className="grid min-h-11 grid-cols-[10rem_1fr] items-center gap-3">
                  <dt className="text-muted-foreground">Completed</dt>
                  <dd>
                    {data.run.completedAt
                      ? formatDateTime(data.run.completedAt)
                      : "In progress"}
                  </dd>
                </div>
                <div className="grid min-h-11 grid-cols-[10rem_1fr] items-center gap-3">
                  <dt className="text-muted-foreground">Runtime thread</dt>
                  <dd className="break-all font-mono text-xs">
                    {runtimeThreadId ? String(runtimeThreadId) : "Not started"}
                  </dd>
                </div>
                <div className="grid min-h-11 grid-cols-[10rem_1fr] items-center gap-3">
                  <dt className="text-muted-foreground">Runtime started</dt>
                  <dd>{runtimeStarted ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Usage at a glance</h2>
              <dl className="mt-3 divide-y border-y text-sm">
                <div className="flex min-h-11 items-center justify-between">
                  <dt className="text-muted-foreground">Model calls</dt>
                  <dd className="font-mono">
                    {data.contextProfile.modelCallCount ??
                      (data.contextProfile.providerTurnCount
                        ? `${data.contextProfile.providerTurnCount} provider turns`
                        : "Aggregate only")}
                  </dd>
                </div>
                <div className="flex min-h-11 items-center justify-between">
                  <dt className="text-muted-foreground">Tool calls</dt>
                  <dd className="font-mono">
                    {data.contextProfile.toolCalls.length}
                  </dd>
                </div>
                <div className="flex min-h-11 items-center justify-between">
                  <dt className="text-muted-foreground">Peak input</dt>
                  <dd className="font-mono">
                    {integer.format(
                      data.contextProfile.peakModelCallInputTokens ?? 0,
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          {data.budget ? (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Budget accounting</h2>
              <dl className="mt-3 grid divide-y border-y text-sm sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
                {[
                  ["State", data.budget.status.replaceAll("_", " ")],
                  [
                    "Token ceiling",
                    data.budget.maxTokens === null
                      ? "Unlimited"
                      : integer.format(data.budget.maxTokens),
                  ],
                  [
                    "Cost ceiling",
                    data.budget.maxCostUsd === null
                      ? "Unlimited"
                      : usd.format(data.budget.maxCostUsd),
                  ],
                  ["Observed tokens", integer.format(data.budget.actualTokens)],
                  [
                    "Observed cost",
                    data.budget.actualCostUsd === null
                      ? "Not priced"
                      : usd.format(data.budget.actualCostUsd),
                  ],
                ].map(([label, amount]) => (
                  <div key={String(label)} className="min-h-16 p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-mono text-xs capitalize">
                      {amount}
                    </dd>
                  </div>
                ))}
              </dl>
              {data.budget.reason ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Reason:{" "}
                  <span className="font-mono">{data.budget.reason}</span>
                </p>
              ) : null}
            </section>
          ) : null}
          {skipped && (
            <section className="rounded-lg border border-stone-400/40 bg-stone-500/5 p-4">
              <h2 className="text-sm font-semibold">
                {budgetSkipped
                  ? "Skipped · budget policy"
                  : "Skipped · stale Work trigger"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {budgetSkipped
                  ? `Run did not start because the budget policy rejected it (${budgetSkipReason}).`
                  : skipReason}{" "}
                Runner was not invoked.
              </p>
              {!budgetSkipped ? (
                <pre className="mt-3 max-w-full overflow-auto rounded-md border bg-background/70 p-3 font-mono text-xs leading-5">
                  {JSON.stringify(
                    {
                      expected: skipped.payload.expectedCondition,
                      observed: skipped.payload.observedState,
                    },
                    null,
                    2,
                  )}
                </pre>
              ) : null}
            </section>
          )}
          {data.run.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {data.run.error}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Persisted event timeline</h2>
            <div className="relative ml-2 mt-4 border-l pl-6">
              {data.events.map((event) => (
                <article key={event.id} className="relative pb-5 last:pb-0">
                  <CircleDot className="absolute -left-[1.86rem] top-0.5 size-3.5 bg-card text-primary" />
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">
                      {event.type.replaceAll("_", " ")}
                    </strong>
                    <time className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-2 font-mono text-xs text-muted-foreground">
                    {Object.keys(event.payload).length
                      ? JSON.stringify(event.payload)
                      : "No payload"}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="context">
          <RunContextUsage
            profile={data.contextProfile}
            runtimeSkipped={Boolean(skipped)}
          />
        </TabsContent>

        <TabsContent value="tools">
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Wrench className="size-4" />
              <h2 className="text-sm font-semibold">Tool breakdown</h2>
            </div>
            <DenseTable minWidth="620px">
              <thead>
                <tr>
                  <th className={denseTableHead}>Tool</th>
                  <th className={denseTableHead}>Calls</th>
                  <th className={denseTableHead}>Responses</th>
                  <th className={denseTableHead}>Largest</th>
                </tr>
              </thead>
              <tbody>
                {data.contextProfile.toolBreakdown.map((tool) => (
                  <tr key={tool.key}>
                    <td className={`${denseTableCell} font-mono text-xs`}>
                      {tool.key}
                    </td>
                    <td className={`${denseTableCell} font-mono text-xs`}>
                      {tool.calls}
                    </td>
                    <td className={`${denseTableCell} font-mono text-xs`}>
                      ≈{integer.format(tool.responseApproxTokens)} tok
                    </td>
                    <td
                      className={`${denseTableCell} font-mono text-xs text-muted-foreground`}
                    >
                      ≈{integer.format(tool.largestResponseApproxTokens)} tok
                    </td>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
            {!data.contextProfile.toolBreakdown.length && (
              <p className="py-5 text-sm text-muted-foreground">
                No completed tool calls.
              </p>
            )}
          </section>
        </TabsContent>

        <TabsContent value="debug">
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Terminal className="size-4" />
              <h2 className="text-sm font-semibold">Raw persisted events</h2>
            </div>
            <div className="space-y-2">
              {data.events.map((event) => (
                <details key={event.id} className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {event.type.replaceAll("_", " ")}{" "}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </summary>
                  <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-5">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
