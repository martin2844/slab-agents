import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        ["completed", "done", "connected", "approved"].includes(status) &&
          "border-emerald-600/25 bg-emerald-500/10 text-emerald-800",
        ["running", "in_progress"].includes(status) &&
          "border-blue-600/25 bg-blue-500/10 text-blue-800",
        ["failed", "denied"].includes(status) &&
          "border-destructive/25 bg-destructive/10 text-destructive",
        ["waiting_approval", "pending"].includes(status) &&
          "border-amber-600/25 bg-amber-500/10 text-amber-800",
        status === "skipped" &&
          "border-stone-500/25 bg-stone-500/10 text-stone-700",
      )}
    >
      {normalized}
    </Badge>
  );
}
