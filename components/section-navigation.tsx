import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const sectionNavigationScrollerClass =
  "min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const sectionNavigationItemsClass = "flex min-w-max gap-6";

export const sectionNavigationItemClass =
  "relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-0 px-0 text-sm transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SectionNavigationFrame({
  children,
  trailing,
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-16 z-20 -mt-5 bg-background/95 backdrop-blur-sm lg:top-0",
        className,
      )}
    >
      <div className="flex min-w-0 items-end border-b">
        {children}
        {trailing}
      </div>
    </div>
  );
}
