import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded-full px-2 text-[0.68rem] capitalize",
        ["completed", "done", "connected", "approved"].includes(status) &&
          "border-emerald-600/25 bg-emerald-500/10 text-emerald-800",
        ["running", "in_progress"].includes(status) &&
          "border-primary/25 bg-primary/10 text-primary",
        ["failed", "denied"].includes(status) &&
          "border-destructive/25 bg-destructive/10 text-destructive",
        ["waiting_approval", "pending"].includes(status) &&
          "border-amber-600/25 bg-amber-500/10 text-amber-800",
        ["queued", "idle"].includes(status) &&
          "border-stone-500/25 bg-stone-500/10 text-stone-700",
        ["blocked"].includes(status) &&
          "border-amber-700/25 bg-amber-500/10 text-amber-900",
        ["review"].includes(status) &&
          "border-violet-600/25 bg-violet-500/10 text-violet-800",
        ["disabled", "cancelled"].includes(status) && "opacity-60",
        status === "skipped" &&
          "border-stone-500/25 bg-stone-500/10 text-stone-700",
      )}
    >
      {normalized}
    </Badge>
  );
}
