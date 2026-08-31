import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const settingControlWidths = {
  compact: "w-full sm:max-w-44",
  medium: "w-full sm:max-w-sm",
  wide: "w-full max-w-2xl",
  grouped: "w-full max-w-[42rem]",
} as const;

export function SettingsStatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?:
    | "positive"
    | "neutral"
    | "requirement"
    | "experimental"
    | "disabled"
    | "critical";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded-[4px] px-1.5 font-mono text-[0.65rem] font-medium tracking-[0.01em]",
        tone === "positive" && "border-accent/80 bg-accent-muted text-success",
        tone === "neutral" &&
          "border-border/80 bg-muted/70 text-muted-foreground",
        tone === "requirement" &&
          "border-foreground/20 bg-card text-foreground",
        tone === "experimental" &&
          "border-dashed border-foreground/25 bg-transparent text-muted-foreground",
        tone === "disabled" && "border-transparent bg-muted text-meta",
        tone === "critical" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        className,
      )}
    >
      {children}
    </Badge>
  );
}

export function SettingSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t border-foreground/20", className)}>
      <div className="flex items-start justify-between gap-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[0.925rem] font-[650] tracking-[-0.01em]">
            {title}
          </h2>
          {description ? (
            <div className="mt-0.5 max-w-3xl text-[0.8125rem] leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {action}
      </div>
      <div className="divide-y divide-border/70 border-y border-border/80">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  children,
  className,
  layout = "default",
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  layout?: "default" | "wide";
}) {
  return (
    <div
      className={cn(
        "grid gap-x-8 gap-y-3 py-4",
        layout === "default" &&
          "md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)] md:items-start xl:grid-cols-[minmax(14rem,18rem)_minmax(0,36rem)]",
        layout === "wide" &&
          "md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)] md:items-start xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-[600] leading-5">{title}</h3>
        {description ? (
          <div className="mt-0.5 max-w-xl text-[0.8125rem] leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 md:min-h-9">{children}</div>
    </div>
  );
}
