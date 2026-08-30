import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t", className)}>
      <div className="flex items-start justify-between gap-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="divide-y border-y">{children}</div>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(18rem,.9fr)] md:items-start",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? (
          <p className="mt-0.5 max-w-xl text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
