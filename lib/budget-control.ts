import "server-only";

import { withImmediateTransaction } from "@/lib/db/transaction";
import {
  defaultPricingCatalog,
  findDefaultModelPrice,
  listDefaultModelPrices,
} from "@/lib/default-model-pricing";
import {
  budgetRepository,
  type BudgetReservationRecord,
} from "@/lib/repositories/budget-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { isRuntimeId, runtimeBudgetCapabilities } from "@/lib/runtime-config";
import type {
  Agent,
  AgentBudgetPolicy,
  BudgetConfiguration,
  Run,
  RunBudgetSnapshot,
  RuntimeModelPrice,
  UsageCostSource,
} from "@/lib/types";

const MICRO_USD = 1_000_000;
const MAX_RUN_TOKENS = 10_000_000_000;
const MAX_BUDGET_USD = 1_000_000;
type NullableNumber = number | null;

export class BudgetConfigurationError extends Error {
  readonly code = "BUDGET_INVALID";
}

function invalid(message: string): never {
  throw new BudgetConfigurationError(message);
}

export type RuntimeBudget = {
  maxTokens: number | null;
  maxCostUsd: number | null;
  pricing: {
    version: number;
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
  } | null;
};

export type BudgetAdmission =
  | { allowed: true; snapshot: RunBudgetSnapshot; runtimeBudget: RuntimeBudget }
  | { allowed: false; snapshot: RunBudgetSnapshot; reason: string };

export type BudgetObservation = {
  newlyExceeded: boolean;
  reason:
    | "token_limit_exceeded"
    | "cost_limit_exceeded"
    | "runtime_budget_exceeded"
    | null;
  snapshot: RunBudgetSnapshot;
};

function usdToMicro(value: NullableNumber): NullableNumber {
  return value === null ? null : Math.round(value * MICRO_USD);
}

function microToUsd(value: NullableNumber): NullableNumber {
  return value === null ? null : value / MICRO_USD;
}

function priceToRecord(price: RuntimeModelPrice) {
  return {
    runtimeId: price.runtimeId,
    model: price.model,
    version: price.version,
    inputMicroUsdPerMillion: usdToMicro(price.inputUsdPerMillion) ?? 0,
    cachedInputMicroUsdPerMillion:
      usdToMicro(price.cachedInputUsdPerMillion) ?? 0,
    outputMicroUsdPerMillion: usdToMicro(price.outputUsdPerMillion) ?? 0,
  };
}

function resolveRuntimePrice(runtimeId: string, model: string) {
  const override = budgetRepository.findRuntimePrice(runtimeId, model);
  if (override) return override;
  const defaultPrice = findDefaultModelPrice(runtimeId, model);
  return defaultPrice ? priceToRecord(defaultPrice) : null;
}

function positiveOrNull(value: NullableNumber, field: string) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    invalid(`${field} must be a positive number or empty.`);
  }
  return value;
}

function positiveUsdOrNull(value: NullableNumber, field: string) {
  const parsed = positiveOrNull(value, field);
  if (parsed !== null) assertMicroUsd(parsed, field);
  return parsed;
}

function integerOrNull(value: NullableNumber, field: string) {
  const parsed = positiveOrNull(value, field);
  if (parsed !== null && !Number.isSafeInteger(parsed)) {
    invalid(`${field} must be a whole number.`);
  }
  if (parsed !== null && parsed > MAX_RUN_TOKENS) {
    invalid(
      `${field} cannot exceed ${MAX_RUN_TOKENS.toLocaleString("en-US")}.`,
    );
  }
  return parsed;
}

function nonnegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    invalid(`${field} must be zero or a positive number.`);
  }
  return value;
}

function nonnegativeUsd(value: number, field: string) {
  const parsed = nonnegative(value, field);
  if (parsed > 0) assertMicroUsd(parsed, field);
  return parsed;
}

function assertMicroUsd(value: number, field: string) {
  const micros = value * MICRO_USD;
  if (micros < 1) invalid(`${field} cannot be smaller than $0.000001.`);
  const floatingTolerance = Number.EPSILON * Math.max(1, Math.abs(micros)) * 4;
  if (Math.abs(micros - Math.round(micros)) > floatingTolerance) {
    invalid(`${field} cannot have more than 6 decimal places.`);
  }
}

function minDefined(...values: NullableNumber[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

function mapReservation(row: BudgetReservationRecord): RunBudgetSnapshot {
  return {
    runId: row.runId,
    status: row.status as RunBudgetSnapshot["status"],
    terminalStatus: row.terminalStatus,
    policyVersion: row.policyVersion,
    pricingVersion: row.pricingVersion,
    maxTokens: row.effectiveMaxTokens,
    maxCostUsd: microToUsd(row.effectiveMaxCostMicroUsd),
    reservedCostUsd: microToUsd(row.reservedCostMicroUsd) ?? 0,
    actualInputTokens: row.actualInputTokens,
    actualCachedInputTokens: row.actualCachedInputTokens,
    actualOutputTokens: row.actualOutputTokens,
    actualTokens: row.actualTotalTokens,
    actualCostUsd: microToUsd(row.actualCostMicroUsd),
    actualCostSource: row.actualCostSource as UsageCostSource | null,
    reason: row.reason,
  };
}

function runtimeBudgetFromReservation(
  row: BudgetReservationRecord,
): RuntimeBudget {
  return {
    maxTokens: row.effectiveMaxTokens,
    maxCostUsd: microToUsd(row.effectiveMaxCostMicroUsd),
    pricing:
      row.pricingVersion === null
        ? null
        : {
            version: row.pricingVersion,
            inputUsdPerMillion:
              microToUsd(row.inputRateMicroUsdPerMillion) ?? 0,
            cachedInputUsdPerMillion:
              microToUsd(row.cachedInputRateMicroUsdPerMillion) ?? 0,
            outputUsdPerMillion:
              microToUsd(row.outputRateMicroUsdPerMillion) ?? 0,
          },
  };
}

function utcWindow(currentTime: Date) {
  const year = currentTime.getUTCFullYear();
  const month = currentTime.getUTCMonth();
  const day = currentTime.getUTCDate();
  return {
    dayStart: new Date(Date.UTC(year, month, day)).toISOString(),
    dayEnd: new Date(Date.UTC(year, month, day + 1)).toISOString(),
    monthStart: new Date(Date.UTC(year, month, 1)).toISOString(),
    monthEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

export function getBudgetConfiguration(): BudgetConfiguration {
  const workspace = budgetRepository.getWorkspace();
  return {
    workspace: {
      version: workspace.policyVersion,
      maxTokensPerRun: workspace.maxTokensPerRun,
      maxCostUsdPerRun: microToUsd(workspace.maxCostMicroUsdPerRun),
      dailyCostUsd: microToUsd(workspace.dailyCostMicroUsd),
      monthlyCostUsd: microToUsd(workspace.monthlyCostMicroUsd),
    },
    agents: budgetRepository.listAgentPolicies().map((policy) => ({
      agentId: policy.agentId,
      maxTokensPerRun: policy.maxTokensPerRun,
      maxCostUsdPerRun: microToUsd(policy.maxCostMicroUsdPerRun),
    })),
    prices: budgetRepository.listRuntimePrices().map((price) => ({
      runtimeId: price.runtimeId,
      model: price.model,
      version: price.version,
      inputUsdPerMillion: microToUsd(price.inputMicroUsdPerMillion) ?? 0,
      cachedInputUsdPerMillion:
        microToUsd(price.cachedInputMicroUsdPerMillion) ?? 0,
      outputUsdPerMillion: microToUsd(price.outputMicroUsdPerMillion) ?? 0,
    })),
    defaultPrices: listDefaultModelPrices(),
    pricingCatalog: defaultPricingCatalog,
  };
}

export function updateBudgetConfiguration(input: {
  expectedVersion: number;
  workspace: Omit<BudgetConfiguration["workspace"], "version">;
  agents: AgentBudgetPolicy[];
  prices: Omit<RuntimeModelPrice, "version">[];
}) {
  const maxTokens = integerOrNull(
    input.workspace.maxTokensPerRun,
    "Run token limit",
  );
  const maxCost = positiveUsdOrNull(
    input.workspace.maxCostUsdPerRun,
    "Run cost limit",
  );
  const daily = positiveUsdOrNull(
    input.workspace.dailyCostUsd,
    "Daily cost limit",
  );
  const monthly = positiveUsdOrNull(
    input.workspace.monthlyCostUsd,
    "Monthly cost limit",
  );
  for (const [label, amount] of [
    ["Run cost limit", maxCost],
    ["Daily cost limit", daily],
    ["Monthly cost limit", monthly],
  ] as const) {
    if (amount !== null && amount > MAX_BUDGET_USD) {
      invalid(
        `${label} cannot exceed $${MAX_BUDGET_USD.toLocaleString("en-US")}.`,
      );
    }
  }
  if ((daily !== null || monthly !== null) && maxCost === null) {
    invalid(
      "A workspace run cost limit is required for daily or monthly reservations.",
    );
  }
  if (daily !== null && maxCost !== null && maxCost > daily) {
    invalid("Run cost limit cannot exceed the daily cost limit.");
  }
  if (monthly !== null && maxCost !== null && maxCost > monthly) {
    invalid("Run cost limit cannot exceed the monthly cost limit.");
  }
  if (daily !== null && monthly !== null && daily > monthly) {
    invalid("Daily cost limit cannot exceed the monthly cost limit.");
  }

  for (const policy of input.agents) {
    integerOrNull(policy.maxTokensPerRun, "Agent token limit");
    positiveUsdOrNull(policy.maxCostUsdPerRun, "Agent cost limit");
    if (
      policy.maxCostUsdPerRun !== null &&
      policy.maxCostUsdPerRun > MAX_BUDGET_USD
    ) {
      invalid(
        `Agent cost limit cannot exceed $${MAX_BUDGET_USD.toLocaleString("en-US")}.`,
      );
    }
    if (
      maxTokens !== null &&
      policy.maxTokensPerRun !== null &&
      policy.maxTokensPerRun > maxTokens
    ) {
      invalid(
        "Agent token overrides must be stricter than the workspace limit.",
      );
    }
    if (
      maxCost !== null &&
      policy.maxCostUsdPerRun !== null &&
      policy.maxCostUsdPerRun > maxCost
    ) {
      invalid(
        "Agent cost overrides must be stricter than the workspace limit.",
      );
    }
  }

  for (const price of input.prices) {
    if (!price.runtimeId.trim() || !price.model.trim()) {
      invalid("Runtime and model are required for pricing.");
    }
    nonnegativeUsd(price.inputUsdPerMillion, "Input price");
    nonnegativeUsd(price.cachedInputUsdPerMillion, "Cached input price");
    nonnegativeUsd(price.outputUsdPerMillion, "Output price");
    if (
      price.inputUsdPerMillion +
        price.cachedInputUsdPerMillion +
        price.outputUsdPerMillion ===
      0
    ) {
      invalid("A pricing entry must include at least one non-zero rate.");
    }
  }
  if (
    new Set(input.agents.map(({ agentId }) => agentId)).size !==
    input.agents.length
  ) {
    invalid("Each Agent can have only one budget override.");
  }
  if (
    new Set(
      input.prices.map(({ runtimeId, model }) => `${runtimeId}\u0000${model}`),
    ).size !== input.prices.length
  ) {
    invalid("Each runtime and model can have only one price.");
  }

  return withImmediateTransaction(() => {
    budgetRepository.replaceConfiguration({
      expectedVersion: input.expectedVersion,
      workspace: {
        maxTokensPerRun: maxTokens,
        maxCostMicroUsdPerRun: usdToMicro(maxCost),
        dailyCostMicroUsd: usdToMicro(daily),
        monthlyCostMicroUsd: usdToMicro(monthly),
      },
      agents: input.agents.map((policy) => ({
        agentId: policy.agentId,
        maxTokensPerRun: policy.maxTokensPerRun,
        maxCostMicroUsdPerRun: usdToMicro(policy.maxCostUsdPerRun),
      })),
      prices: input.prices.map((price) => ({
        runtimeId: price.runtimeId,
        model: price.model,
        inputMicroUsdPerMillion: usdToMicro(price.inputUsdPerMillion) ?? 0,
        cachedInputMicroUsdPerMillion:
          usdToMicro(price.cachedInputUsdPerMillion) ?? 0,
        outputMicroUsdPerMillion: usdToMicro(price.outputUsdPerMillion) ?? 0,
      })),
      timestamp: new Date().toISOString(),
    });
    return getBudgetConfiguration();
  });
}

export function admitRunBudget(
  run: Run,
  agent: Agent,
  currentTime = new Date(),
): BudgetAdmission {
  return withImmediateTransaction(() => {
    const existing = budgetRepository.getReservation(run.id);
    if (existing) {
      const snapshot = mapReservation(existing);
      return snapshot.status === "rejected"
        ? {
            allowed: false as const,
            snapshot,
            reason: snapshot.reason ?? "budget_rejected",
          }
        : {
            allowed: true as const,
            snapshot,
            runtimeBudget: runtimeBudgetFromReservation(existing),
          };
    }

    const workspace = budgetRepository.getWorkspace();
    const agentPolicy = budgetRepository.getAgentPolicy(agent.id);
    const maxTokens = minDefined(
      workspace.maxTokensPerRun,
      agentPolicy?.maxTokensPerRun ?? null,
    );
    const maxCostMicro = minDefined(
      workspace.maxCostMicroUsdPerRun,
      agentPolicy?.maxCostMicroUsdPerRun ?? null,
    );
    const price = resolveRuntimePrice(run.runtime, run.model);
    let reason: string | null = null;
    const hasEnforceableProviderCost =
      isRuntimeId(run.runtime) &&
      (runtimeBudgetCapabilities[run.runtime].nativeCostLimit ||
        runtimeBudgetCapabilities[run.runtime].incrementalCostUsage);
    const hasEnforceableTokenLimit =
      isRuntimeId(run.runtime) &&
      (runtimeBudgetCapabilities[run.runtime].nativeTokenLimit ||
        runtimeBudgetCapabilities[run.runtime].incrementalTokenUsage);
    if (maxTokens !== null && !hasEnforceableTokenLimit) {
      reason = "token_limit_unavailable";
    }
    if (maxCostMicro !== null && !price && !hasEnforceableProviderCost) {
      reason ??= "pricing_unavailable";
    }

    const { dayStart, dayEnd, monthStart, monthEnd } = utcWindow(currentTime);
    if (!reason && maxCostMicro !== null) {
      if (
        workspace.dailyCostMicroUsd !== null &&
        budgetRepository.reservedExposure(dayStart, dayEnd) + maxCostMicro >
          workspace.dailyCostMicroUsd
      ) {
        reason = "daily_budget_exhausted";
      }
      if (
        !reason &&
        workspace.monthlyCostMicroUsd !== null &&
        budgetRepository.reservedExposure(monthStart, monthEnd) + maxCostMicro >
          workspace.monthlyCostMicroUsd
      ) {
        reason = "monthly_budget_exhausted";
      }
    }

    const timestamp = currentTime.toISOString();
    budgetRepository.insertReservation({
      runId: run.id,
      runtimeId: run.runtime,
      model: run.model,
      status: reason ? "rejected" : "active",
      policyVersion: workspace.policyVersion,
      pricingVersion: price?.version ?? null,
      effectiveMaxTokens: maxTokens,
      effectiveMaxCostMicroUsd: maxCostMicro,
      reservedCostMicroUsd: reason ? 0 : (maxCostMicro ?? 0),
      inputRateMicroUsdPerMillion: price?.inputMicroUsdPerMillion ?? null,
      cachedInputRateMicroUsdPerMillion:
        price?.cachedInputMicroUsdPerMillion ?? null,
      outputRateMicroUsdPerMillion: price?.outputMicroUsdPerMillion ?? null,
      reason,
      timestamp,
    });
    const reservation = budgetRepository.getReservation(run.id)!;
    const snapshot = mapReservation(reservation);
    return reason
      ? { allowed: false as const, snapshot, reason }
      : {
          allowed: true as const,
          snapshot,
          runtimeBudget: runtimeBudgetFromReservation(reservation),
        };
  });
}

function usageNumber(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (typeof data[key] === "number" && Number.isFinite(data[key])) {
      return Math.max(0, Math.floor(data[key] as number));
    }
  }
  return 0;
}

function resolvedUsageModel(data: Record<string, unknown>) {
  if (typeof data.model !== "string") return null;
  const model = data.model.trim();
  return model.length > 0 && model.length <= 200 && model !== "default"
    ? model
    : null;
}

export function observeRunUsage(
  runId: string,
  eventKey: string,
  data: Record<string, unknown>,
  runnerRunId?: string,
): BudgetObservation | null {
  return withImmediateTransaction(() => {
    let reservation = budgetRepository.getReservation(runId);
    if (!reservation || reservation.status === "rejected") return null;
    const observedModel = resolvedUsageModel(data);
    let modelResolved = false;
    if (reservation.model === "default" && observedModel) {
      const price = resolveRuntimePrice(reservation.runtimeId, observedModel);
      const timestamp = new Date().toISOString();
      modelResolved = Boolean(
        budgetRepository.resolveReservationModel({
          runId,
          model: observedModel,
          pricingVersion: price?.version ?? null,
          inputRateMicroUsdPerMillion: price?.inputMicroUsdPerMillion ?? null,
          cachedInputRateMicroUsdPerMillion:
            price?.cachedInputMicroUsdPerMillion ?? null,
          outputRateMicroUsdPerMillion: price?.outputMicroUsdPerMillion ?? null,
          timestamp,
        }),
      );
      runRepository.resolveModel(runId, observedModel);
      reservation = budgetRepository.getReservation(runId)!;
    }
    const usageScope =
      data.usageScope === "run_aggregate" ? "run_aggregate" : "model_call";
    const inputTokens = usageNumber(data, "inputTokens", "input_tokens");
    const cachedInputTokens = usageNumber(
      data,
      "cachedInputTokens",
      "cached_input_tokens",
    );
    const outputTokens = usageNumber(data, "outputTokens", "output_tokens");
    const totalTokens =
      usageNumber(data, "totalTokens", "total_tokens") ||
      inputTokens + outputTokens;
    const reportedCost =
      usageScope === "run_aggregate" ? data.totalCostUsd : data.costUsd;
    const reportedCostMicroUsd =
      typeof reportedCost === "number" &&
      Number.isFinite(reportedCost) &&
      reportedCost >= 0
        ? usdToMicro(reportedCost)
        : null;
    const legacyCostSource =
      data.costSource === undefined
        ? reservation.runtimeId === "openrouter"
          ? "provider_reported"
          : reservation.runtimeId === "claude"
            ? "sdk_estimated"
            : null
        : null;
    const costSource =
      data.costSource === "provider_reported" ||
      data.costSource === "sdk_estimated"
        ? data.costSource
        : legacyCostSource;
    const providerCostMicroUsd =
      costSource === "provider_reported" ? reportedCostMicroUsd : null;
    const estimatedCostMicroUsd =
      costSource === "sdk_estimated" ? reportedCostMicroUsd : null;
    const resolvedRunnerRunId =
      runnerRunId ??
      (eventKey.includes(":")
        ? eventKey.slice(0, eventKey.lastIndexOf(":"))
        : eventKey);
    const timestamp = new Date().toISOString();
    const inserted = budgetRepository.insertUsageObservation({
      runId,
      eventKey,
      runnerRunId: resolvedRunnerRunId,
      usageScope,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens,
      providerCostMicroUsd,
      estimatedCostMicroUsd,
      costSource,
      timestamp,
    });
    if (!inserted && !modelResolved) {
      return {
        newlyExceeded: false,
        reason: null,
        snapshot: mapReservation(reservation),
      };
    }

    const observations = budgetRepository.listUsageObservations(runId);
    const byRunnerRun = new Map<string, (typeof observations)[number][]>();
    for (const observation of observations) {
      const execution = byRunnerRun.get(observation.runnerRunId) ?? [];
      execution.push(observation);
      byRunnerRun.set(observation.runnerRunId, execution);
    }
    const source = [...byRunnerRun.values()].flatMap((execution) => {
      const aggregate = execution
        .filter((row) => row.usageScope === "run_aggregate")
        .at(-1);
      return aggregate ? [aggregate] : execution;
    });
    const totals = source.reduce(
      (sum, row) => ({
        input: sum.input + row.inputTokens,
        cached: sum.cached + row.cachedInputTokens,
        output: sum.output + row.outputTokens,
        total: sum.total + row.totalTokens,
        provider: sum.provider + (row.providerCostMicroUsd ?? 0),
        hasProvider: sum.hasProvider || row.providerCostMicroUsd !== null,
        estimated: sum.estimated + (row.estimatedCostMicroUsd ?? 0),
        hasEstimated: sum.hasEstimated || row.estimatedCostMicroUsd !== null,
      }),
      {
        input: 0,
        cached: 0,
        output: 0,
        total: 0,
        provider: 0,
        hasProvider: false,
        estimated: 0,
        hasEstimated: false,
      },
    );
    const calculatedCostMicroUsd =
      reservation.pricingVersion === null
        ? null
        : Math.ceil(
            (Math.max(0, totals.input - totals.cached) *
              Number(reservation.inputRateMicroUsdPerMillion) +
              totals.cached *
                Number(reservation.cachedInputRateMicroUsdPerMillion) +
              totals.output *
                Number(reservation.outputRateMicroUsdPerMillion)) /
              1_000_000,
          );
    const actualCostSource: UsageCostSource = totals.hasProvider
      ? "provider_reported"
      : totals.hasEstimated
        ? "sdk_estimated"
        : totals.total === 0
          ? "no_usage"
          : calculatedCostMicroUsd !== null
            ? "pricing_snapshot"
            : "unpriced";
    const actualCostMicroUsd = totals.hasProvider
      ? totals.provider
      : totals.hasEstimated
        ? totals.estimated
        : totals.total === 0
          ? 0
          : calculatedCostMicroUsd;
    const tokenExceeded =
      reservation.effectiveMaxTokens !== null &&
      totals.total >= reservation.effectiveMaxTokens;
    const costExceeded =
      actualCostMicroUsd !== null &&
      reservation.effectiveMaxCostMicroUsd !== null &&
      actualCostMicroUsd >= reservation.effectiveMaxCostMicroUsd;
    const reason: BudgetObservation["reason"] = tokenExceeded
      ? "token_limit_exceeded"
      : costExceeded
        ? "cost_limit_exceeded"
        : null;
    const newlyExceeded = Boolean(reason && reservation.status !== "exceeded");
    budgetRepository.updateReservationUsage({
      runId,
      inputTokens: totals.input,
      cachedInputTokens: totals.cached,
      outputTokens: totals.output,
      totalTokens: totals.total,
      calculatedCostMicroUsd,
      providerCostMicroUsd: totals.hasProvider ? totals.provider : null,
      estimatedCostMicroUsd:
        actualCostSource === "sdk_estimated"
          ? totals.estimated
          : actualCostSource === "pricing_snapshot"
            ? calculatedCostMicroUsd
            : null,
      actualCostMicroUsd,
      actualCostSource,
      reason,
      timestamp,
    });
    return {
      newlyExceeded,
      reason,
      snapshot: mapReservation(budgetRepository.getReservation(runId)!),
    };
  });
}

export function markRunBudgetExceeded(runId: string): BudgetObservation | null {
  return withImmediateTransaction(() => {
    const current = budgetRepository.getReservation(runId);
    if (!current || current.status === "rejected") return null;
    const newlyExceeded = current.status !== "exceeded";
    budgetRepository.markReservationExceeded(runId, new Date().toISOString());
    return {
      newlyExceeded,
      reason: "runtime_budget_exceeded" as const,
      snapshot: mapReservation(budgetRepository.getReservation(runId)!),
    };
  });
}

export function settleRunBudget(runId: string, terminalStatus: string) {
  budgetRepository.settleReservation(
    runId,
    terminalStatus,
    new Date().toISOString(),
  );
  return getRunBudget(runId);
}

export function releaseRunBudgetWithoutRuntime(
  runId: string,
  terminalStatus: string,
) {
  budgetRepository.releaseReservationWithoutRuntime(
    runId,
    terminalStatus,
    new Date().toISOString(),
  );
  return getRunBudget(runId);
}

export function getRunBudget(runId: string): RunBudgetSnapshot | null {
  const row = budgetRepository.getReservation(runId);
  return row ? mapReservation(row) : null;
}
