import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  meta,
  action,
  className,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="text-sm font-[650] tracking-[-0.015em]">{title}</h2>
        {meta && (
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        )}
      </div>
      {action}
    </div>
  );
}

export type MetricStripItem = {
  label: string;
  value: React.ReactNode;
  detail?: string;
  icon?: LucideIcon;
  tone?: "default" | "attention" | "running";
};

export function MetricStrip({ items }: { items: MetricStripItem[] }) {
  return (
    <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className={cn(
              "flex min-h-20 items-center gap-3 border-b px-4 py-3 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0",
              index === items.length - 1 && "sm:border-b-0",
              item.tone === "attention" && "bg-amber-500/[0.055]",
              item.tone === "running" && "bg-accent-muted/60",
            )}
          >
            {Icon && (
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground",
                  item.tone === "running" &&
                    "bg-accent text-accent-foreground",
                  item.tone === "attention" && "bg-amber-500/10 text-amber-800",
                )}
              >
                <Icon className="size-4" />
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-[675] tabular-nums tracking-[-0.025em]">
                  {item.value}
                </span>
                <span className="truncate text-sm font-[550]">
                  {item.label}
                </span>
              </div>
              {item.detail && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function DenseTable({
  children,
  minWidth = "760px",
  className,
}: {
  children: React.ReactNode;
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-x-auto rounded-lg border bg-card",
        className,
      )}
    >
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth }}
      >
        {children}
      </table>
    </div>
  );
}

export const denseTableHead =
  "h-9 border-b bg-muted/65 px-3 font-mono text-[0.66rem] font-medium uppercase tracking-[0.02em] text-muted-foreground";
export const denseTableCell = "h-11 border-b px-3 align-middle last:border-b-0";
