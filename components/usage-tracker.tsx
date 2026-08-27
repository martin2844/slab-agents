"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  DollarSign,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { api } from "@/lib/client-api";
import type {
  UsageBudgetWindow,
  UsageSummary,
  UsageSummaryBreakdown,
  UsageSummaryPeriod,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const periods: Array<{ value: UsageSummaryPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
];

function formatUsd(value: number) {
  const digits = value > 0 && value < 0.0001 ? 6 : value < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  return value === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
}

function trackedCost(item: UsageSummaryBreakdown) {
  return (
    item.providerReportedUsd + item.sdkEstimatedUsd + item.pricingEstimatedUsd
  );
}

function Progress({
  value,
  label,
  valueText,
}: {
  value: number;
  label: string;
  valueText: string;
}) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-border/70"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(value * 100))}
      aria-label={`${label} budget usage`}
      aria-valuetext={valueText}
    >
      <span
        className={cn(
          "block h-full rounded-full transition-[width]",
          value >= 1
            ? "bg-destructive"
            : value >= 0.8
              ? "bg-amber-500"
              : "bg-accent",
        )}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
  );
}

function BudgetMeter({
  label,
  window,
}: {
  label: string;
  window: UsageBudgetWindow;
}) {
  const ratio =
    window.limitUsd && window.limitUsd > 0
      ? window.committedUsd / window.limitUsd
      : null;
  return (
    <div className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[0.66rem] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-xs font-semibold">
          {window.limitUsd === null
            ? "No limit"
            : `${formatUsd(window.committedUsd)} / ${formatUsd(window.limitUsd)}`}
        </span>
      </div>
      {ratio === null ? (
        <div className="mt-2 h-1.5 rounded-full border border-dashed border-border" />
      ) : (
        <div className="mt-2">
          <Progress
            value={ratio}
            label={label}
            valueText={`${formatUsd(window.committedUsd)} committed of ${formatUsd(window.limitUsd!)} limit`}
          />
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {formatUsd(window.spentUsd)} tracked
        {window.activeReservedUsd > 0
          ? ` · ${formatUsd(window.activeReservedUsd)} active reservation`
          : " · no active reservations"}
      </p>
    </div>
  );
}

function Breakdown({
  title,
  items,
}: {
  title: string;
  items: UsageSummaryBreakdown[];
}) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </h3>
      <div className="border-t border-border">
        {items.length ? (
          items.slice(0, 6).map((item) => {
            const estimatedUsd =
              item.sdkEstimatedUsd + item.pricingEstimatedUsd;
            return (
              <div
                key={item.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.label}</p>
                  <p className="mt-0.5 truncate font-mono text-[0.66rem] text-muted-foreground">
                    {item.context ? `${item.context} · ` : ""}
                    {item.runs} {item.runs === 1 ? "run" : "runs"}
                  </p>
                  <p className="mt-1 truncate font-mono text-[0.62rem] text-muted-foreground">
                    {item.providerReportedUsd > 0
                      ? `${formatUsd(item.providerReportedUsd)} reported`
                      : "No reported cost"}
                    {estimatedUsd > 0
                      ? ` · ${formatUsd(estimatedUsd)} estimated`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs font-semibold">
                    {formatUsd(trackedCost(item))}
                  </p>
                  <p className="mt-0.5 font-mono text-[0.66rem] text-muted-foreground">
                    {formatTokens(item.tokens)} tok
                  </p>
                  {item.unpricedTokens > 0 ? (
                    <p className="mt-1 font-mono text-[0.6rem] text-amber-700 dark:text-amber-300">
                      {formatTokens(item.unpricedTokens)} unpriced
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="border-b border-border py-3 text-sm text-muted-foreground">
            No runs admitted in this period.
          </p>
        )}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-96 place-items-center" aria-live="polite">
      <div className="text-center">
        <RefreshCw className="mx-auto size-5 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Reading the ledger…
        </p>
      </div>
    </div>
  );
}

function UsageDashboard({ summary }: { summary: UsageSummary }) {
  const uncachedInput = Math.max(
    0,
    summary.tokens.input - summary.tokens.cachedInput,
  );
  const compositionTotal = Math.max(
    1,
    uncachedInput + summary.tokens.cachedInput + summary.tokens.output,
  );
  const refreshedAt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(summary.generatedAt));

  return (
    <>
      <div className="grid border-b border-border lg:grid-cols-[1.5fr_1fr]">
        <section className="p-5 sm:p-6">
          <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Tracked cost · by run admission
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="font-heading text-5xl font-[675] tracking-[-0.055em] sm:text-6xl">
              {formatUsd(summary.costs.trackedUsd)}
            </p>
            <p className="pb-1.5 font-mono text-xs text-muted-foreground">
              {formatTokens(summary.tokens.total)} tokens · {summary.runs.total}{" "}
              {summary.runs.total === 1 ? "run" : "runs"}
            </p>
          </div>

          <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
            <div className="bg-background p-3">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.04em] text-muted-foreground">
                Provider reported
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {formatUsd(summary.costs.providerReportedUsd)}
              </p>
            </div>
            <div className="bg-background p-3">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.04em] text-muted-foreground">
                SDK estimate
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {formatUsd(summary.costs.sdkEstimatedUsd)}
              </p>
            </div>
            <div className="bg-background p-3">
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.04em] text-muted-foreground">
                Price estimate
              </p>
              <p className="mt-1 font-mono text-sm font-semibold">
                {formatUsd(summary.costs.pricingEstimatedUsd)}
              </p>
            </div>
          </div>
        </section>

        <aside className="border-t border-border bg-muted/35 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-base font-[650]">
              Budget exposure
            </h3>
            <Button asChild variant="ghost" size="xs">
              <Link href="/settings">
                Configure <ArrowUpRight />
              </Link>
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            <BudgetMeter label="Today · UTC" window={summary.budgets.day} />
            <BudgetMeter
              label="This month · UTC"
              window={summary.budgets.month}
            />
          </div>
        </aside>
      </div>

      <section className="border-b border-border p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-heading text-base font-[650]">
                Token composition
              </h3>
              <span className="font-mono text-xs text-muted-foreground">
                {formatPercent(summary.tokens.cacheHitRate)} cache hit
              </span>
            </div>
            <div
              className="mt-3 flex h-3 overflow-hidden rounded-sm bg-muted"
              aria-label="Token composition"
            >
              <span
                className="bg-primary"
                style={{
                  width: `${(uncachedInput / compositionTotal) * 100}%`,
                }}
                title={`Uncached input ${formatTokens(uncachedInput)}`}
              />
              <span
                className="bg-accent"
                style={{
                  width: `${(summary.tokens.cachedInput / compositionTotal) * 100}%`,
                }}
                title={`Cached input ${formatTokens(summary.tokens.cachedInput)}`}
              />
              <span
                className="bg-chart-2"
                style={{
                  width: `${(summary.tokens.output / compositionTotal) * 100}%`,
                }}
                title={`Output ${formatTokens(summary.tokens.output)}`}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-5 font-mono text-xs">
            <div>
              <span className="mb-1 block size-2 bg-primary" />
              <span className="text-muted-foreground">Input</span>
              <strong className="mt-0.5 block">
                {formatTokens(uncachedInput)}
              </strong>
            </div>
            <div>
              <span className="mb-1 block size-2 bg-accent" />
              <span className="text-muted-foreground">Cached</span>
              <strong className="mt-0.5 block">
                {formatTokens(summary.tokens.cachedInput)}
              </strong>
            </div>
            <div>
              <span className="mb-1 block size-2 bg-chart-2" />
              <span className="text-muted-foreground">Output</span>
              <strong className="mt-0.5 block">
                {formatTokens(summary.tokens.output)}
              </strong>
            </div>
          </div>
        </div>
      </section>

      {summary.tokens.unpriced > 0 ? (
        <div className="flex items-start gap-3 border-b border-amber-300/70 bg-amber-50 px-5 py-3 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100 sm:px-6">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="text-sm">
            {formatTokens(summary.tokens.unpriced)} tokens from{" "}
            {summary.runs.unpriced}{" "}
            {summary.runs.unpriced === 1 ? "run has" : "runs have"} no price.
            Add model pricing in{" "}
            <Link
              className="font-semibold underline underline-offset-3"
              href="/settings"
            >
              Settings
            </Link>{" "}
            to include them in estimates.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-3">
        <Breakdown title="By runtime" items={summary.breakdowns.runtimes} />
        <Breakdown title="By model" items={summary.breakdowns.models} />
        <Breakdown title="By agent" items={summary.breakdowns.agents} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/35 px-5 py-3 font-mono text-[0.66rem] text-muted-foreground sm:px-6">
        <span>
          Periods use each run&apos;s admission time (UTC). Reported costs are
          provider values; all other costs are estimates.
        </span>
        <span>Updated {refreshedAt}</span>
      </div>
    </>
  );
}

export function UsageTracker() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<UsageSummaryPeriod>("today");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (targetPeriod: UsageSummaryPeriod) => {
    const request = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await api<UsageSummary>(
        `/api/usage/summary?period=${encodeURIComponent(targetPeriod)}`,
        { cache: "no-store" },
      );
      if (request !== requestSequence.current) return;
      setSummary(next);
      setError(null);
    } catch (caught) {
      if (request !== requestSequence.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Usage summary could not be loaded",
      );
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);
  const poll = useCallback(
    () => (open ? load(period) : Promise.resolve()),
    [load, open, period],
  );
  useOperationalPolling(poll, 15_000);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void load(period);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="relative border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-foreground lg:border-border lg:bg-background lg:text-foreground lg:hover:bg-muted lg:hover:text-foreground"
                  aria-label="Open AI usage and cost dashboard"
                />
              }
            />
          }
        >
          <DollarSign className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">AI usage and cost</TooltipContent>
      </Tooltip>

      <DialogContent className="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:text-white sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-5xl">
        <DialogHeader className="gap-4 bg-petrol-deep px-5 pb-4 pt-5 text-white sm:px-6">
          <div className="pr-10">
            <DialogTitle className="text-xl text-white">
              AI burn ledger
            </DialogTitle>
            <DialogDescription className="mt-1 text-white/60">
              Cost, tokens, and exposure attributed to budget admission time.
            </DialogDescription>
          </div>
          <div
            className="flex w-full gap-1 overflow-x-auto"
            aria-label="Usage period"
          >
            {periods.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  period === item.value
                    ? "bg-accent text-accent-foreground"
                    : "text-white/60 hover:bg-white/10 hover:text-white",
                )}
                aria-pressed={period === item.value}
                onClick={() => {
                  if (item.value === period) return;
                  setSummary(null);
                  setError(null);
                  setPeriod(item.value);
                  void load(item.value);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto bg-background">
          {error ? (
            <div
              className="flex items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/5 px-5 py-2.5 text-sm text-destructive sm:px-6"
              role="status"
            >
              <span>{summary ? `Showing last update · ${error}` : error}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void load(period)}
              >
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : null}
          {loading && !summary ? <LoadingState /> : null}
          {summary ? <UsageDashboard summary={summary} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
