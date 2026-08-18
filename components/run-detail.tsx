import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { RunContextUsage } from "@/components/run-context-usage";
import type { RunDetailData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
export function RunDetail({ data }: { data: RunDetailData }) {
  const skipped = [...data.events]
    .reverse()
    .find((event) => event.type === "run_skipped");
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
        eyebrow="Run detail"
        title={data.run.id.slice(0, 12)}
        description="Inspect model-call usage, context growth, tool payload weight, and the persisted event trail."
        actions={
          <Button variant="outline" asChild>
            <Link href="/runs">
              <ArrowLeft />
              All runs
            </Link>
          </Button>
        }
      />
      {skipped && (
        <section className="mb-6 border border-stone-400/40 bg-stone-500/5 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Control-plane decision
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            Skipped — stale Work trigger
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {skipReason} Runner was not invoked.
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Runtime started</dt>
              <dd className="mt-1 font-medium">
                {runtimeStarted ? "Yes" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Model calls</dt>
              <dd className="mt-1 font-mono font-medium">0</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Runtime tokens</dt>
              <dd className="mt-1 font-mono font-medium">0</dd>
            </div>
          </dl>
          <pre className="mt-4 max-w-full overflow-auto border bg-background/70 p-3 font-mono text-xs leading-5">
            {JSON.stringify(
              {
                expected: skipped.payload.expectedCondition,
                observed: skipped.payload.observedState,
              },
              null,
              2,
            )}
          </pre>
        </section>
      )}
      <RunContextUsage
        profile={data.contextProfile}
        runtimeSkipped={Boolean(skipped)}
      />
      <div className="mt-10 grid gap-8 xl:grid-cols-[1fr_20rem]">
        <section className="min-w-0" aria-labelledby="persisted-events-title">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Debug log
            </p>
            <h2
              id="persisted-events-title"
              className="mt-1 text-xl font-semibold"
            >
              Persisted events
            </h2>
          </div>
          <div className="relative ml-2 border-l pl-8">
            {data.events.map((event, index) => (
              <article key={event.id} className="relative min-w-0 pb-8">
                <span
                  className={`absolute -left-[2.28rem] top-1 size-3 rounded-full ring-4 ring-background ${event.type.includes("failed") ? "bg-destructive" : event.type.includes("completed") ? "bg-emerald-600" : "bg-primary"}`}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-sm font-semibold">
                    {event.type.replaceAll("_", " ")}
                  </h2>
                  <time className="text-xs text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </time>
                </div>
                {Object.keys(event.payload).length > 0 && (
                  <pre className="mt-3 max-w-full overflow-auto border bg-muted/50 p-3 font-mono text-xs leading-5">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
                {index === data.events.length - 1 && (
                  <span className="absolute -left-[2.05rem] bottom-0 h-5 w-px bg-background" />
                )}
              </article>
            ))}
          </div>
        </section>
        <aside className="space-y-6 border-t pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Status
            </p>
            <div className="mt-2">
              <StatusBadge status={data.run.status} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Trigger
            </p>
            <p className="mt-2 text-sm capitalize">
              {data.run.trigger.replaceAll("_", " ")}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Execution mode
            </p>
            <p className="mt-2 text-sm capitalize">
              {data.run.mode.replaceAll("_", " ")}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Associated issue
            </p>
            <p className="mt-2 font-mono text-sm">
              {data.run.issueKey ?? "None"}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Runtime
            </p>
            <p className="mt-2 text-sm capitalize">{data.run.runtime}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Runtime thread
            </p>
            <p className="mt-2 break-all font-mono text-xs">
              {runtimeThreadId ? String(runtimeThreadId) : "Not started"}
            </p>
            {runtimeContinuity && (
              <p className="mt-1 text-xs capitalize text-muted-foreground">
                Continuity: {String(runtimeContinuity)}
              </p>
            )}
          </div>
          {data.run.error && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-destructive">
                Error
              </p>
              <p className="mt-2 text-sm leading-6 text-destructive">
                {data.run.error}
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
