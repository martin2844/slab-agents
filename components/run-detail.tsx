import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { RunContextUsage } from "@/components/run-context-usage";
import type { RunDetailData } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
export function RunDetail({ data }: { data: RunDetailData }) {
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
      <RunContextUsage profile={data.contextProfile} />
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
              Runtime
            </p>
            <p className="mt-2 text-sm capitalize">{data.run.runtime}</p>
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
