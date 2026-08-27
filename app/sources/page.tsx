import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpenText, Database, PlugZap } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sources" };

export default function SourcesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Context"
        title="Sources"
        description="The planned home for external sources of truth that agents will use alongside your maintained Docs knowledge."
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]">
        <div className="rounded-lg border border-dashed bg-card p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Database className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-2xl font-[675] tracking-[-0.03em]">
                  Source connections
                </h2>
                <Badge variant="secondary">Planned</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                No external context sources are available yet.
              </p>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-6 text-muted-foreground">
            This is where repositories, file stores, knowledge systems, and
            other governed records will be connected. Each source will expose
            its provenance, sync health, and agent access before its content is
            used in a run.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Provenance", "See where context came from."],
              ["Freshness", "Know when a source last synchronized."],
              ["Access", "Choose which agents may use it."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-lg border bg-card p-5">
          <BookOpenText className="size-5 text-primary" />
          <h2 className="mt-4 text-base font-semibold">Docs remain canonical</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use Docs for maintained company knowledge. Sources will complement
            it with externally managed records; persistent agent memory is not
            treated as a source of truth.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/docs">
                Open Docs <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/settings?tab=connections">
                <PlugZap /> Service connections
              </Link>
            </Button>
          </div>
        </aside>
      </section>
    </>
  );
}
