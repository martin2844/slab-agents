import "server-only";

import { db, now } from "@/lib/db";
import type {
  Agent,
  AgentBudgetPolicy,
  BudgetConfiguration,
  Run,
  RunBudgetSnapshot,
  RuntimeModelPrice,
} from "@/lib/types";
import { isRuntimeId, runtimeBudgetCapabilities } from "@/lib/runtime-config";

const MICRO_USD = 1_000_000;
const MAX_RUN_TOKENS = 10_000_000_000;
const MAX_BUDGET_USD = 1_000_000;

type Row = Record<string, unknown>;
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

function numberOrNull(value: unknown): NullableNumber {
  return value === null || value === undefined ? null : Number(value);
}

function usdToMicro(value: NullableNumber): NullableNumber {
  return value === null ? null : Math.round(value * MICRO_USD);
}

function microToUsd(value: unknown): NullableNumber {
  const amount = numberOrNull(value);
  return amount === null ? null : amount / MICRO_USD;
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
  if (parsed !== null) {
    assertMicroUsd(parsed, field);
  }
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
  if (micros < 1) {
    invalid(`${field} cannot be smaller than $0.000001.`);
  }
  const floatingTolerance = Number.EPSILON * Math.max(1, Math.abs(micros)) * 4;
  if (Math.abs(micros - Math.round(micros)) > floatingTolerance) {
    invalid(`${field} cannot have more than 6 decimal places.`);
  }
}

function minDefined(...values: NullableNumber[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

function mapWorkspace(row: Row): BudgetConfiguration["workspace"] {
  return {
    version: Number(row.policy_version),
    maxTokensPerRun: numberOrNull(row.max_tokens_per_run),
    maxCostUsdPerRun: microToUsd(row.max_cost_micro_usd_per_run),
    dailyCostUsd: microToUsd(row.daily_cost_micro_usd),
    monthlyCostUsd: microToUsd(row.monthly_cost_micro_usd),
  };
}

function mapAgent(row: Row): AgentBudgetPolicy {
  return {
    agentId: String(row.agent_id),
    maxTokensPerRun: numberOrNull(row.max_tokens_per_run),
    maxCostUsdPerRun: microToUsd(row.max_cost_micro_usd_per_run),
  };
}

function mapPrice(row: Row): RuntimeModelPrice {
  return {
    runtimeId: String(row.runtime_id),
    model: String(row.model),
    version: Number(row.version),
    inputUsdPerMillion: microToUsd(row.input_micro_usd_per_million) ?? 0,
    cachedInputUsdPerMillion:
      microToUsd(row.cached_input_micro_usd_per_million) ?? 0,
    outputUsdPerMillion: microToUsd(row.output_micro_usd_per_million) ?? 0,
  };
}

function mapReservation(row: Row): RunBudgetSnapshot {
  return {
    runId: String(row.run_id),
    status: row.status as RunBudgetSnapshot["status"],
    terminalStatus: row.terminal_status ? String(row.terminal_status) : null,
    policyVersion: Number(row.policy_version),
    pricingVersion: numberOrNull(row.pricing_version),
    maxTokens: numberOrNull(row.effective_max_tokens),
    maxCostUsd: microToUsd(row.effective_max_cost_micro_usd),
    reservedCostUsd: microToUsd(row.reserved_cost_micro_usd) ?? 0,
    actualTokens: Number(row.actual_total_tokens ?? 0),
    actualCostUsd: microToUsd(row.actual_cost_micro_usd),
    reason: row.reason ? String(row.reason) : null,
  };
}

function priceFor(runtimeId: string, model: string) {
  return db
    .prepare(
      `SELECT * FROM runtime_model_prices
       WHERE runtime_id=? AND model IN (?, 'default')
       ORDER BY CASE WHEN model=? THEN 0 ELSE 1 END LIMIT 1`,
    )
    .get(runtimeId, model, model) as Row | undefined;
}

function utcWindow(nowValue: Date) {
  const year = nowValue.getUTCFullYear();
  const month = nowValue.getUTCMonth();
  const day = nowValue.getUTCDate();
  return {
    dayStart: new Date(Date.UTC(year, month, day)).toISOString(),
    dayEnd: new Date(Date.UTC(year, month, day + 1)).toISOString(),
    monthStart: new Date(Date.UTC(year, month, 1)).toISOString(),
    monthEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

function reservedExposure(start: string, end: string) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN status IN ('reserved','active') THEN reserved_cost_micro_usd
           WHEN actual_cost_micro_usd IS NOT NULL THEN actual_cost_micro_usd
           ELSE reserved_cost_micro_usd
         END
       ),0) AS exposure
       FROM run_budget_reservations
       WHERE status != 'rejected' AND created_at >= ? AND created_at < ?`,
    )
    .get(start, end) as Row;
  return Number(row.exposure ?? 0);
}

function runtimeBudgetFromRow(row: Row): RuntimeBudget {
  const pricingVersion = numberOrNull(row.pricing_version);
  return {
    maxTokens: numberOrNull(row.effective_max_tokens),
    maxCostUsd: microToUsd(row.effective_max_cost_micro_usd),
    pricing:
      pricingVersion === null
        ? null
        : {
            version: pricingVersion,
            inputUsdPerMillion:
              microToUsd(row.input_rate_micro_usd_per_million) ?? 0,
            cachedInputUsdPerMillion:
              microToUsd(row.cached_input_rate_micro_usd_per_million) ?? 0,
            outputUsdPerMillion:
              microToUsd(row.output_rate_micro_usd_per_million) ?? 0,
          },
  };
}

export function getBudgetConfiguration(): BudgetConfiguration {
  const workspace = db
    .prepare("SELECT * FROM workspace_budget_policies WHERE id=1")
    .get() as Row;
  return {
    workspace: mapWorkspace(workspace),
    agents: (
      db
        .prepare("SELECT * FROM agent_budget_policies ORDER BY agent_id")
        .all() as Row[]
    ).map(mapAgent),
    prices: (
      db
        .prepare("SELECT * FROM runtime_model_prices ORDER BY runtime_id,model")
        .all() as Row[]
    ).map(mapPrice),
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
    if (!price.runtimeId.trim() || !price.model.trim())
      invalid("Runtime and model are required for pricing.");
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

  return db
    .transaction(() => {
      const current = db
        .prepare(
          "SELECT policy_version FROM workspace_budget_policies WHERE id=1",
        )
        .get() as Row;
      if (Number(current.policy_version) !== input.expectedVersion) {
        const error = new Error(
          "Budget configuration changed. Reload and retry.",
        ) as Error & { code?: string };
        error.code = "VERSION_CONFLICT";
        throw error;
      }
      const timestamp = now();
      db.prepare(
        `UPDATE workspace_budget_policies SET policy_version=policy_version+1,
       max_tokens_per_run=?,max_cost_micro_usd_per_run=?,daily_cost_micro_usd=?,monthly_cost_micro_usd=?,updated_at=? WHERE id=1`,
      ).run(
        maxTokens,
        usdToMicro(maxCost),
        usdToMicro(daily),
        usdToMicro(monthly),
        timestamp,
      );
      db.prepare("DELETE FROM agent_budget_policies").run();
      const insertAgent = db.prepare(
        `INSERT INTO agent_budget_policies
       (agent_id,max_tokens_per_run,max_cost_micro_usd_per_run,created_at,updated_at) VALUES (?,?,?,?,?)`,
      );
      for (const policy of input.agents) {
        if (policy.maxTokensPerRun === null && policy.maxCostUsdPerRun === null)
          continue;
        insertAgent.run(
          policy.agentId,
          policy.maxTokensPerRun,
          usdToMicro(policy.maxCostUsdPerRun),
          timestamp,
          timestamp,
        );
      }
      const seenPrices = new Set(
        input.prices.map((price) => `${price.runtimeId}\u0000${price.model}`),
      );
      const existingPrices = db
        .prepare("SELECT runtime_id,model FROM runtime_model_prices")
        .all() as Row[];
      for (const row of existingPrices) {
        if (!seenPrices.has(`${row.runtime_id}\u0000${row.model}`)) {
          db.prepare(
            "DELETE FROM runtime_model_prices WHERE runtime_id=? AND model=?",
          ).run(row.runtime_id, row.model);
        }
      }
      for (const price of input.prices) {
        db.prepare(
          `INSERT INTO runtime_model_prices
         (runtime_id,model,version,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,created_at,updated_at)
         VALUES (?,?,1,?,?,?,?,?)
         ON CONFLICT(runtime_id,model) DO UPDATE SET version=version+1,
         input_micro_usd_per_million=excluded.input_micro_usd_per_million,
         cached_input_micro_usd_per_million=excluded.cached_input_micro_usd_per_million,
         output_micro_usd_per_million=excluded.output_micro_usd_per_million,updated_at=excluded.updated_at`,
        ).run(
          price.runtimeId,
          price.model,
          usdToMicro(price.inputUsdPerMillion),
          usdToMicro(price.cachedInputUsdPerMillion),
          usdToMicro(price.outputUsdPerMillion),
          timestamp,
          timestamp,
        );
      }
      return getBudgetConfiguration();
    })
    .immediate();
}

export function admitRunBudget(
  run: Run,
  agent: Agent,
  currentTime = new Date(),
): BudgetAdmission {
  return db
    .transaction(() => {
      const existing = db
        .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
        .get(run.id) as Row | undefined;
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
              runtimeBudget: runtimeBudgetFromRow(existing),
            };
      }
      const workspace = db
        .prepare("SELECT * FROM workspace_budget_policies WHERE id=1")
        .get() as Row;
      const agentPolicy = db
        .prepare("SELECT * FROM agent_budget_policies WHERE agent_id=?")
        .get(agent.id) as Row | undefined;
      const maxTokens = minDefined(
        numberOrNull(workspace.max_tokens_per_run),
        numberOrNull(agentPolicy?.max_tokens_per_run),
      );
      const maxCostMicro = minDefined(
        numberOrNull(workspace.max_cost_micro_usd_per_run),
        numberOrNull(agentPolicy?.max_cost_micro_usd_per_run),
      );
      const price = priceFor(run.runtime, run.model);
      let reason: string | null = null;
      const hasNativeCostLimit =
        isRuntimeId(run.runtime) &&
        runtimeBudgetCapabilities[run.runtime].nativeCostLimit;
      const hasEnforceableTokenLimit =
        isRuntimeId(run.runtime) &&
        (runtimeBudgetCapabilities[run.runtime].nativeTokenLimit ||
          runtimeBudgetCapabilities[run.runtime].incrementalTokenUsage);
      if (maxTokens !== null && !hasEnforceableTokenLimit) {
        reason = "token_limit_unavailable";
      }
      if (maxCostMicro !== null && !price && !hasNativeCostLimit)
        reason ??= "pricing_unavailable";
      const { dayStart, dayEnd, monthStart, monthEnd } = utcWindow(currentTime);
      if (!reason && maxCostMicro !== null) {
        const daily = numberOrNull(workspace.daily_cost_micro_usd);
        const monthly = numberOrNull(workspace.monthly_cost_micro_usd);
        if (
          daily !== null &&
          reservedExposure(dayStart, dayEnd) + maxCostMicro > daily
        )
          reason = "daily_budget_exhausted";
        if (
          !reason &&
          monthly !== null &&
          reservedExposure(monthStart, monthEnd) + maxCostMicro > monthly
        )
          reason = "monthly_budget_exhausted";
      }
      const timestamp = currentTime.toISOString();
      const status = reason ? "rejected" : "active";
      db.prepare(
        `INSERT INTO run_budget_reservations
       (run_id,runtime_id,model,status,policy_version,pricing_version,effective_max_tokens,effective_max_cost_micro_usd,
        reserved_cost_micro_usd,input_rate_micro_usd_per_million,cached_input_rate_micro_usd_per_million,
        output_rate_micro_usd_per_million,reason,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        run.id,
        run.runtime,
        run.model,
        status,
        workspace.policy_version,
        price?.version ?? null,
        maxTokens,
        maxCostMicro,
        reason ? 0 : (maxCostMicro ?? 0),
        price?.input_micro_usd_per_million ?? null,
        price?.cached_input_micro_usd_per_million ?? null,
        price?.output_micro_usd_per_million ?? null,
        reason,
        timestamp,
        timestamp,
      );
      const row = db
        .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
        .get(run.id) as Row;
      const snapshot = mapReservation(row);
      return reason
        ? { allowed: false as const, snapshot, reason }
        : {
            allowed: true as const,
            snapshot,
            runtimeBudget: runtimeBudgetFromRow(row),
          };
    })
    .immediate();
}

function usageNumber(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys)
    if (typeof data[key] === "number" && Number.isFinite(data[key]))
      return Math.max(0, Math.floor(data[key] as number));
  return 0;
}

export function observeRunUsage(
  runId: string,
  eventKey: string,
  data: Record<string, unknown>,
): BudgetObservation | null {
  return db
    .transaction(() => {
      const reservation = db
        .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
        .get(runId) as Row | undefined;
      if (!reservation || reservation.status === "rejected") return null;
      const scope =
        data.usageScope === "run_aggregate" ? "run_aggregate" : "model_call";
      const input = usageNumber(data, "inputTokens", "input_tokens");
      const cached = usageNumber(
        data,
        "cachedInputTokens",
        "cached_input_tokens",
      );
      const output = usageNumber(data, "outputTokens", "output_tokens");
      const total =
        usageNumber(data, "totalTokens", "total_tokens") || input + output;
      const providerCost =
        typeof data.totalCostUsd === "number" &&
        Number.isFinite(data.totalCostUsd)
          ? usdToMicro(Math.max(0, data.totalCostUsd))
          : null;
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO budget_usage_observations
       (run_id,event_key,usage_scope,input_tokens,cached_input_tokens,output_tokens,total_tokens,provider_cost_micro_usd,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          runId,
          eventKey,
          scope,
          input,
          cached,
          output,
          total,
          providerCost,
          now(),
        ).changes;
      if (!inserted)
        return {
          newlyExceeded: false,
          reason: null,
          snapshot: mapReservation(reservation),
        };
      const observations = db
        .prepare(
          "SELECT * FROM budget_usage_observations WHERE run_id=? ORDER BY rowid",
        )
        .all(runId) as Row[];
      const aggregate = observations
        .filter((row) => row.usage_scope === "run_aggregate")
        .at(-1);
      const source = aggregate ? [aggregate] : observations;
      const totals = source.reduce<{
        input: number;
        cached: number;
        output: number;
        total: number;
        provider: number;
        hasProvider: boolean;
      }>(
        (sum, row) => ({
          input: sum.input + Number(row.input_tokens),
          cached: sum.cached + Number(row.cached_input_tokens),
          output: sum.output + Number(row.output_tokens),
          total: sum.total + Number(row.total_tokens),
          provider: sum.provider + Number(row.provider_cost_micro_usd ?? 0),
          hasProvider: sum.hasProvider || row.provider_cost_micro_usd !== null,
        }),
        {
          input: 0,
          cached: 0,
          output: 0,
          total: 0,
          provider: 0,
          hasProvider: false,
        },
      );
      const calculate =
        reservation.pricing_version === null
          ? null
          : Math.ceil(
              (Math.max(0, totals.input - totals.cached) *
                Number(reservation.input_rate_micro_usd_per_million) +
                totals.cached *
                  Number(reservation.cached_input_rate_micro_usd_per_million) +
                totals.output *
                  Number(reservation.output_rate_micro_usd_per_million)) /
                1_000_000,
            );
      const actualCost = totals.hasProvider ? totals.provider : calculate;
      const tokenExceeded =
        reservation.effective_max_tokens !== null &&
        totals.total >= Number(reservation.effective_max_tokens);
      const costExceeded =
        actualCost !== null &&
        reservation.effective_max_cost_micro_usd !== null &&
        actualCost >= Number(reservation.effective_max_cost_micro_usd);
      const reason: BudgetObservation["reason"] = tokenExceeded
        ? "token_limit_exceeded"
        : costExceeded
          ? "cost_limit_exceeded"
          : null;
      const newlyExceeded = Boolean(
        reason && reservation.status !== "exceeded",
      );
      db.prepare(
        `UPDATE run_budget_reservations SET actual_input_tokens=?,actual_cached_input_tokens=?,actual_output_tokens=?,actual_total_tokens=?,
       calculated_cost_micro_usd=?,provider_cost_micro_usd=?,actual_cost_micro_usd=?,status=CASE WHEN ? IS NULL THEN status ELSE 'exceeded' END,
       reason=COALESCE(?,reason),exceeded_at=CASE WHEN ? IS NULL THEN exceeded_at ELSE COALESCE(exceeded_at,?) END,updated_at=? WHERE run_id=?`,
      ).run(
        totals.input,
        totals.cached,
        totals.output,
        totals.total,
        calculate,
        totals.hasProvider ? totals.provider : null,
        actualCost,
        reason,
        reason,
        reason,
        now(),
        now(),
        runId,
      );
      const updated = db
        .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
        .get(runId) as Row;
      return { newlyExceeded, reason, snapshot: mapReservation(updated) };
    })
    .immediate();
}

export function markRunBudgetExceeded(runId: string): BudgetObservation | null {
  return db
    .transaction(() => {
      const current = db
        .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
        .get(runId) as Row | undefined;
      if (!current || current.status === "rejected") return null;
      const newlyExceeded = current.status !== "exceeded";
      db.prepare(
        `UPDATE run_budget_reservations SET status='exceeded',reason=COALESCE(reason,'runtime_budget_exceeded'),
       exceeded_at=COALESCE(exceeded_at,?),updated_at=? WHERE run_id=?`,
      ).run(now(), now(), runId);
      const updated = db
        .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
        .get(runId) as Row;
      return {
        newlyExceeded,
        reason: "runtime_budget_exceeded" as const,
        snapshot: mapReservation(updated),
      };
    })
    .immediate();
}

export function settleRunBudget(runId: string, terminalStatus: string) {
  db.prepare(
    `UPDATE run_budget_reservations SET status=CASE WHEN status='exceeded' THEN status WHEN status='rejected' THEN status ELSE 'settled' END,
     terminal_status=?,settled_at=COALESCE(settled_at,?),updated_at=? WHERE run_id=?`,
  ).run(terminalStatus, now(), now(), runId);
  return getRunBudget(runId);
}

export function releaseRunBudgetWithoutRuntime(
  runId: string,
  terminalStatus: string,
) {
  db.prepare(
    `UPDATE run_budget_reservations SET status=CASE WHEN status='rejected' THEN status ELSE 'settled' END,
     terminal_status=?,actual_input_tokens=0,actual_cached_input_tokens=0,actual_output_tokens=0,actual_total_tokens=0,
     calculated_cost_micro_usd=0,provider_cost_micro_usd=0,actual_cost_micro_usd=0,
     settled_at=COALESCE(settled_at,?),updated_at=? WHERE run_id=?`,
  ).run(terminalStatus, now(), now(), runId);
  return getRunBudget(runId);
}

export function getRunBudget(runId: string): RunBudgetSnapshot | null {
  const row = db
    .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
    .get(runId) as Row | undefined;
  return row ? mapReservation(row) : null;
}
