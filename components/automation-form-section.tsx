import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function AutomationFormSection({
  id,
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "grid scroll-mt-24 gap-4 border-t border-border/80 py-6 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
        <div className="flex items-center gap-2 text-sm font-[650]">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </div>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="sm:pl-[12.5rem]">{children}</div>
    </section>
  );
}
