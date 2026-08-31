import "server-only";

import {
  budgetRepository,
  type UsageAggregateRecord,
  type UsageBreakdownRecord,
} from "@/lib/repositories/budget-repository";
import type {
  UsageBudgetWindow,
  UsageSummary,
  UsageSummaryBreakdown,
  UsageSummaryPeriod,
} from "@/lib/types";

const MICRO_USD = 1_000_000;

function microToUsd(value: number) {
  return value / MICRO_USD;
}

function utcWindows(now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  return {
    dayStart: new Date(Date.UTC(year, month, day)).toISOString(),
    monthStart: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
}

function periodStart(period: UsageSummaryPeriod, now: Date) {
  const { dayStart, monthStart } = utcWindows(now);
  switch (period) {
    case "today":
      return dayStart;
    case "7d":
      return new Date(now.getTime() - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 86_400_000).toISOString();
    case "month":
      return monthStart;
    case "all":
      return null;
  }
}

function trackedCost(row: UsageAggregateRecord) {
  return (
    row.providerCostMicroUsd +
    row.sdkEstimatedCostMicroUsd +
    row.pricingEstimatedCostMicroUsd
  );
}

export function getTodayUsagePulse(currentTime = new Date()) {
  const to = currentTime.toISOString();
  const aggregate = budgetRepository.summarizeUsage(
    utcWindows(currentTime).dayStart,
    to,
  );
  return {
    trackedUsd: microToUsd(trackedCost(aggregate)),
    totalTokens: aggregate.totalTokens,
    unpricedTokens: aggregate.unpricedTokens,
  };
}

function mapBreakdown(row: UsageBreakdownRecord): UsageSummaryBreakdown {
  return {
    key: row.key,
    label: row.label,
    context: row.context,
    runs: row.runs,
    tokens: row.totalTokens,
    providerReportedUsd: microToUsd(row.providerCostMicroUsd),
    sdkEstimatedUsd: microToUsd(row.sdkEstimatedCostMicroUsd),
    pricingEstimatedUsd: microToUsd(row.pricingEstimatedCostMicroUsd),
    unpricedTokens: row.unpricedTokens,
  };
}

function budgetWindow(
  aggregate: UsageAggregateRecord,
  limitMicroUsd: number | null,
  committedMicroUsd: number,
  activeReservedMicroUsd: number,
): UsageBudgetWindow {
  return {
    limitUsd: limitMicroUsd === null ? null : microToUsd(limitMicroUsd),
    spentUsd: microToUsd(trackedCost(aggregate)),
    committedUsd: microToUsd(committedMicroUsd),
    activeReservedUsd: microToUsd(activeReservedMicroUsd),
  };
}

export function getUsageSummary(
  period: UsageSummaryPeriod,
  currentTime = new Date(),
): UsageSummary {
  const to = currentTime.toISOString();
  const from = periodStart(period, currentTime);
  const aggregate = budgetRepository.summarizeUsage(from, to);
  const workspace = budgetRepository.getWorkspace();
  const { dayStart, monthStart } = utcWindows(currentTime);
  const day = budgetRepository.summarizeUsage(dayStart, to);
  const month = budgetRepository.summarizeUsage(monthStart, to);
  const cacheHitRate =
    aggregate.inputTokens > 0
      ? aggregate.cachedInputTokens / aggregate.inputTokens
      : null;

  return {
    period,
    basis: "budget_admission_at",
    from,
    to,
    generatedAt: to,
    costs: {
      trackedUsd: microToUsd(trackedCost(aggregate)),
      providerReportedUsd: microToUsd(aggregate.providerCostMicroUsd),
      sdkEstimatedUsd: microToUsd(aggregate.sdkEstimatedCostMicroUsd),
      pricingEstimatedUsd: microToUsd(aggregate.pricingEstimatedCostMicroUsd),
    },
    tokens: {
      input: aggregate.inputTokens,
      cachedInput: aggregate.cachedInputTokens,
      output: aggregate.outputTokens,
      total: aggregate.totalTokens,
      cacheHitRate,
      unpriced: aggregate.unpricedTokens,
    },
    runs: {
      total: aggregate.runs,
      priced: aggregate.pricedRuns,
      unpriced: aggregate.unpricedRuns,
      active: aggregate.activeRuns,
    },
    budgets: {
      day: budgetWindow(
        day,
        workspace.dailyCostMicroUsd,
        budgetRepository.reservedExposure(dayStart, to),
        budgetRepository.activeReservedExposure(dayStart, to),
      ),
      month: budgetWindow(
        month,
        workspace.monthlyCostMicroUsd,
        budgetRepository.reservedExposure(monthStart, to),
        budgetRepository.activeReservedExposure(monthStart, to),
      ),
    },
    breakdowns: {
      runtimes: budgetRepository
        .listUsageBreakdown("runtime", from, to)
        .map(mapBreakdown),
      models: budgetRepository
        .listUsageBreakdown("model", from, to)
        .map(mapBreakdown),
      agents: budgetRepository
        .listUsageBreakdown("agent", from, to)
        .map(mapBreakdown),
    },
  };
}
