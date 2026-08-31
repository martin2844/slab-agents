import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
export function StatusBadge({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded-full px-2 font-mono text-[0.68rem] font-medium tracking-[0.02em] capitalize",
        [
          "completed",
          "done",
          "connected",
          "approved",
          "installed",
          "passed",
          "succeeded",
          "up_to_date",
          "channel_equivalent",
          "enabled",
          "matched",
        ].includes(status) && "border-accent bg-accent-muted text-success",
        ["running", "in_progress", "installing", "evaluating"].includes(
          status,
        ) && "border-accent bg-accent text-accent-foreground",
        ["failed", "error", "denied", "partial_failure"].includes(status) &&
          "border-destructive/25 bg-destructive/10 text-destructive",
        [
          "waiting_approval",
          "pending",
          "needs setup",
          "update available",
          "update_available",
          "recovery_required",
        ].includes(status) &&
          "border-amber-600/25 bg-amber-500/10 text-amber-800",
        ["queued", "idle", "submitted", "channel_older"].includes(status) &&
          "border-border bg-muted text-muted-foreground",
        ["blocked"].includes(status) &&
          "border-amber-700/25 bg-amber-500/10 text-amber-900",
        ["review"].includes(status) &&
          "border-violet-600/25 bg-violet-500/10 text-violet-800",
        ["disabled", "cancelled", "draft", "paused", "archived"].includes(
          status,
        ) && "border-border bg-muted text-muted-foreground opacity-70",
        status === "skipped" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {normalized}
    </Badge>
  );
}
