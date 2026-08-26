import Image from "next/image";
import { cn } from "@/lib/utils";

export function SlabBrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary",
        className,
      )}
    >
      <Image
        src="/brand/slab-relay.svg"
        alt=""
        width={12}
        height={18}
        priority
      />
    </span>
  );
}
