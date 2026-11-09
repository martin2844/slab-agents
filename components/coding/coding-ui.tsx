"use client";

import {
  Check,
  ClipboardList,
  Code2,
  FileCode2,
  GitPullRequestArrow,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Pause,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { CodeStageStatus, CodingStage } from "@/lib/coding/stages";

export const STAGE_ICONS: Record<CodingStage, LucideIcon> = {
  pm: ClipboardList,
  tech_spec: FileCode2,
  plan_review: ShieldCheck,
  engineer: Code2,
  code_review: GitPullRequestArrow,
  publish: Upload,
  final_pass: Sparkles,
  pr_feedback: MessagesSquare,
  chat: MessageCircle,
};

export function formatDuration(ms: number | null | undefined) {
  if (!ms || ms < 1000) return ms ? "<1s" : "—";
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatCost(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${value.toFixed(2)}`;
}

export function formatTokens(input: number, output: number) {
  const total = input + output;
  if (!total) return "—";
  const short = (value: number) =>
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `${Math.round(value / 1_000)}k`
        : String(value);
  return `${short(input)} / ${short(output)} tokens`;
}

export function elapsed(start: string, end: string | null, now = Date.now()) {
  return Math.max(0, (end ? Date.parse(end) : now) - Date.parse(start));
}

/** Current time, or null during server render and the first client render (avoids hydration mismatches). */
export function useNow(intervalMs = 1_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

/** Elapsed time that ticks while running; renders "—" until mounted for open runs. */
export function Elapsed({ start, end }: { start: string; end: string | null }) {
  const now = useNow();
  if (!end && now === null) return <>—</>;
  return <>{formatDuration(elapsed(start, end, now ?? undefined))}</>;
}

/** Local clock time, rendered only on the client (server timezone and locale differ). */
export function LocalTime({ value, seconds = false }: { value: string; seconds?: boolean }) {
  const now = useNow(60_000);
  if (now === null) return null;
  return (
    <>
      {new Date(value).toLocaleTimeString([], seconds ? undefined : { hour: "2-digit", minute: "2-digit" })}
    </>
  );
}

export function StageStatusDot({
  status,
  className,
}: {
  status: CodeStageStatus | "pending";
  className?: string;
}) {
  const base =
    "absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full border-2 border-card";
  if (status === "done")
    return (
      <span className={cn(base, "bg-emerald-500 text-white", className)}>
        <Check className="size-2" strokeWidth={4} />
      </span>
    );
  if (status === "running" || status === "queued")
    return (
      <span className={cn(base, "bg-accent text-accent-foreground", className)}>
        <LoaderCircle className="size-2 animate-spin" strokeWidth={4} />
      </span>
    );
  if (status === "failed")
    return (
      <span className={cn(base, "bg-destructive text-white", className)}>
        <X className="size-2" strokeWidth={4} />
      </span>
    );
  if (status === "needs_input" || status === "waiting_approval")
    return (
      <span className={cn(base, "bg-amber-500 text-white", className)}>
        <Pause className="size-2" strokeWidth={4} />
      </span>
    );
  if (status === "cancelled")
    return <span className={cn(base, "bg-muted-foreground", className)} />;
  return null;
}

export function stageTone(status: CodeStageStatus | "pending") {
  switch (status) {
    case "done":
      return "border-emerald-500/40 text-emerald-700";
    case "running":
    case "queued":
      return "border-accent text-accent-foreground";
    case "needs_input":
    case "waiting_approval":
      return "border-amber-500/50 text-amber-800";
    case "failed":
      return "border-destructive/50 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}
