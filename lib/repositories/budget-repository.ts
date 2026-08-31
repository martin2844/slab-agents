import "server-only";

import { db } from "@/lib/db/database";

type Row = Record<string, unknown>;

export type WorkspaceBudgetRecord = {
  policyVersion: number;
  maxTokensPerRun: number | null;
  maxCostMicroUsdPerRun: number | null;
  dailyCostMicroUsd: number | null;
  monthlyCostMicroUsd: number | null;
};

export type AgentBudgetRecord = {
  agentId: string;
  maxTokensPerRun: number | null;
  maxCostMicroUsdPerRun: number | null;
};

export type RuntimePriceRecord = {
  runtimeId: string;
  model: string;
  version: number;
  inputMicroUsdPerMillion: number;
  cachedInputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
};

export type BudgetReservationRecord = {
  runId: string;
  runtimeId: string;
  model: string;
  status: string;
  terminalStatus: string | null;
  policyVersion: number;
  pricingVersion: number | null;
  effectiveMaxTokens: number | null;
  effectiveMaxCostMicroUsd: number | null;
  reservedCostMicroUsd: number;
  actualInputTokens: number;
  actualCachedInputTokens: number;
  actualOutputTokens: number;
  actualTotalTokens: number;
  calculatedCostMicroUsd: number | null;
  providerCostMicroUsd: number | null;
  estimatedCostMicroUsd: number | null;
  actualCostMicroUsd: number | null;
  actualCostSource: string | null;
  reason: string | null;
  inputRateMicroUsdPerMillion: number | null;
  cachedInputRateMicroUsdPerMillion: number | null;
  outputRateMicroUsdPerMillion: number | null;
};

export type UsageObservationRecord = {
  runnerRunId: string;
  usageScope: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerCostMicroUsd: number | null;
  estimatedCostMicroUsd: number | null;
  costSource: string | null;
};

export type UsageAggregateRecord = {
  runs: number;
  pricedRuns: number;
  unpricedRuns: number;
  activeRuns: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  unpricedTokens: number;
  providerCostMicroUsd: number;
  sdkEstimatedCostMicroUsd: number;
  pricingEstimatedCostMicroUsd: number;
};

export type UsageBreakdownRecord = UsageAggregateRecord & {
  key: string;
  label: string;
  context: string | null;
};

type UsageBreakdownDimension = "runtime" | "model" | "agent";

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function mapWorkspace(row: Row): WorkspaceBudgetRecord {
  return {
    policyVersion: Number(row.policy_version),
    maxTokensPerRun: nullableNumber(row.max_tokens_per_run),
    maxCostMicroUsdPerRun: nullableNumber(row.max_cost_micro_usd_per_run),
    dailyCostMicroUsd: nullableNumber(row.daily_cost_micro_usd),
    monthlyCostMicroUsd: nullableNumber(row.monthly_cost_micro_usd),
  };
}

function mapAgent(row: Row): AgentBudgetRecord {
  return {
    agentId: String(row.agent_id),
    maxTokensPerRun: nullableNumber(row.max_tokens_per_run),
    maxCostMicroUsdPerRun: nullableNumber(row.max_cost_micro_usd_per_run),
  };
}

function mapPrice(row: Row): RuntimePriceRecord {
  return {
    runtimeId: String(row.runtime_id),
    model: String(row.model),
    version: Number(row.version),
    inputMicroUsdPerMillion: Number(row.input_micro_usd_per_million),
    cachedInputMicroUsdPerMillion: Number(
      row.cached_input_micro_usd_per_million,
    ),
    outputMicroUsdPerMillion: Number(row.output_micro_usd_per_million),
  };
}

function mapReservation(row: Row): BudgetReservationRecord {
  return {
    runId: String(row.run_id),
    runtimeId: String(row.runtime_id),
    model: String(row.model),
    status: String(row.status),
    terminalStatus: row.terminal_status ? String(row.terminal_status) : null,
    policyVersion: Number(row.policy_version),
    pricingVersion: nullableNumber(row.pricing_version),
    effectiveMaxTokens: nullableNumber(row.effective_max_tokens),
    effectiveMaxCostMicroUsd: nullableNumber(row.effective_max_cost_micro_usd),
    reservedCostMicroUsd: Number(row.reserved_cost_micro_usd ?? 0),
    actualInputTokens: Number(row.actual_input_tokens ?? 0),
    actualCachedInputTokens: Number(row.actual_cached_input_tokens ?? 0),
    actualOutputTokens: Number(row.actual_output_tokens ?? 0),
    actualTotalTokens: Number(row.actual_total_tokens ?? 0),
    calculatedCostMicroUsd: nullableNumber(row.calculated_cost_micro_usd),
    providerCostMicroUsd: nullableNumber(row.provider_cost_micro_usd),
    estimatedCostMicroUsd: nullableNumber(row.estimated_cost_micro_usd),
    actualCostMicroUsd: nullableNumber(row.actual_cost_micro_usd),
    actualCostSource: row.actual_cost_source
      ? String(row.actual_cost_source)
      : null,
    reason: row.reason ? String(row.reason) : null,
    inputRateMicroUsdPerMillion: nullableNumber(
      row.input_rate_micro_usd_per_million,
    ),
    cachedInputRateMicroUsdPerMillion: nullableNumber(
      row.cached_input_rate_micro_usd_per_million,
    ),
    outputRateMicroUsdPerMillion: nullableNumber(
      row.output_rate_micro_usd_per_million,
    ),
  };
}

function mapUsageAggregate(row: Row): UsageAggregateRecord {
  return {
    runs: Number(row.runs ?? 0),
    pricedRuns: Number(row.priced_runs ?? 0),
    unpricedRuns: Number(row.unpriced_runs ?? 0),
    activeRuns: Number(row.active_runs ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    unpricedTokens: Number(row.unpriced_tokens ?? 0),
    providerCostMicroUsd: Number(row.provider_cost_micro_usd ?? 0),
    sdkEstimatedCostMicroUsd: Number(row.sdk_estimated_cost_micro_usd ?? 0),
    pricingEstimatedCostMicroUsd: Number(
      row.pricing_estimated_cost_micro_usd ?? 0,
    ),
  };
}

const usageAggregateColumns = `
  COUNT(*) AS runs,
  SUM(CASE WHEN b.actual_cost_source IN ('provider_reported','sdk_estimated','pricing_snapshot') THEN 1 ELSE 0 END) AS priced_runs,
  SUM(CASE WHEN b.actual_cost_source='unpriced' THEN 1 ELSE 0 END) AS unpriced_runs,
  SUM(CASE WHEN EXISTS (
    SELECT 1 FROM runs active_run
    WHERE active_run.id=b.run_id
      AND active_run.status IN ('queued','running','waiting_approval')
  ) THEN 1 ELSE 0 END) AS active_runs,
  COALESCE(SUM(b.actual_input_tokens),0) AS input_tokens,
  COALESCE(SUM(b.actual_cached_input_tokens),0) AS cached_input_tokens,
  COALESCE(SUM(b.actual_output_tokens),0) AS output_tokens,
  COALESCE(SUM(b.actual_total_tokens),0) AS total_tokens,
  COALESCE(SUM(CASE WHEN b.actual_cost_source='unpriced' THEN b.actual_total_tokens ELSE 0 END),0) AS unpriced_tokens,
  COALESCE(SUM(CASE WHEN b.actual_cost_source='provider_reported' THEN b.actual_cost_micro_usd ELSE 0 END),0) AS provider_cost_micro_usd,
  COALESCE(SUM(CASE WHEN b.actual_cost_source='sdk_estimated' THEN b.actual_cost_micro_usd ELSE 0 END),0) AS sdk_estimated_cost_micro_usd,
  COALESCE(SUM(CASE WHEN b.actual_cost_source='pricing_snapshot' THEN b.actual_cost_micro_usd ELSE 0 END),0) AS pricing_estimated_cost_micro_usd`;

function usageWindow(start: string | null, end: string) {
  return start === null
    ? { clause: "b.created_at < ?", parameters: [end] }
    : {
        clause: "b.created_at >= ? AND b.created_at < ?",
        parameters: [start, end],
      };
}

export const budgetRepository = {
  getWorkspace(): WorkspaceBudgetRecord {
    return mapWorkspace(
      db
        .prepare("SELECT * FROM workspace_budget_policies WHERE id=1")
        .get() as Row,
    );
  },

  listAgentPolicies(): AgentBudgetRecord[] {
    return (
      db
        .prepare("SELECT * FROM agent_budget_policies ORDER BY agent_id")
        .all() as Row[]
    ).map(mapAgent);
  },

  getAgentPolicy(agentId: string): AgentBudgetRecord | null {
    const row = db
      .prepare("SELECT * FROM agent_budget_policies WHERE agent_id=?")
      .get(agentId) as Row | undefined;
    return row ? mapAgent(row) : null;
  },

  listRuntimePrices(): RuntimePriceRecord[] {
    return (
      db
        .prepare("SELECT * FROM runtime_model_prices ORDER BY runtime_id,model")
        .all() as Row[]
    ).map(mapPrice);
  },

  findRuntimePrice(
    runtimeId: string,
    model: string,
  ): RuntimePriceRecord | null {
    const row = db
      .prepare(
        `SELECT * FROM runtime_model_prices
         WHERE runtime_id=? AND model IN (?, 'default')
         ORDER BY CASE WHEN model=? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .get(runtimeId, model, model) as Row | undefined;
    return row ? mapPrice(row) : null;
  },

  replaceConfiguration(input: {
    expectedVersion: number;
    workspace: Omit<WorkspaceBudgetRecord, "policyVersion">;
    agents: AgentBudgetRecord[];
    prices: Omit<RuntimePriceRecord, "version">[];
    timestamp: string;
  }) {
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

    db.prepare(
      `UPDATE workspace_budget_policies SET policy_version=policy_version+1,
       max_tokens_per_run=?,max_cost_micro_usd_per_run=?,daily_cost_micro_usd=?,monthly_cost_micro_usd=?,updated_at=? WHERE id=1`,
    ).run(
      input.workspace.maxTokensPerRun,
      input.workspace.maxCostMicroUsdPerRun,
      input.workspace.dailyCostMicroUsd,
      input.workspace.monthlyCostMicroUsd,
      input.timestamp,
    );

    db.prepare("DELETE FROM agent_budget_policies").run();
    const insertAgent = db.prepare(
      `INSERT INTO agent_budget_policies
       (agent_id,max_tokens_per_run,max_cost_micro_usd_per_run,created_at,updated_at) VALUES (?,?,?,?,?)`,
    );
    for (const policy of input.agents) {
      if (
        policy.maxTokensPerRun === null &&
        policy.maxCostMicroUsdPerRun === null
      ) {
        continue;
      }
      insertAgent.run(
        policy.agentId,
        policy.maxTokensPerRun,
        policy.maxCostMicroUsdPerRun,
        input.timestamp,
        input.timestamp,
      );
    }

    const seenPrices = new Set(
      input.prices.map((price) => `${price.runtimeId}\u0000${price.model}`),
    );
    const existingPrices = db
      .prepare("SELECT runtime_id,model FROM runtime_model_prices")
      .all() as Row[];
    const deletePrice = db.prepare(
      "DELETE FROM runtime_model_prices WHERE runtime_id=? AND model=?",
    );
    for (const row of existingPrices) {
      if (!seenPrices.has(`${row.runtime_id}\u0000${row.model}`)) {
        deletePrice.run(row.runtime_id, row.model);
      }
    }

    const upsertPrice = db.prepare(
      `INSERT INTO runtime_model_prices
       (runtime_id,model,version,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,created_at,updated_at)
       VALUES (?,?,1,?,?,?,?,?)
       ON CONFLICT(runtime_id,model) DO UPDATE SET version=version+1,
       input_micro_usd_per_million=excluded.input_micro_usd_per_million,
       cached_input_micro_usd_per_million=excluded.cached_input_micro_usd_per_million,
       output_micro_usd_per_million=excluded.output_micro_usd_per_million,updated_at=excluded.updated_at`,
    );
    for (const price of input.prices) {
      upsertPrice.run(
        price.runtimeId,
        price.model,
        price.inputMicroUsdPerMillion,
        price.cachedInputMicroUsdPerMillion,
        price.outputMicroUsdPerMillion,
        input.timestamp,
        input.timestamp,
      );
    }
  },

  getReservation(runId: string): BudgetReservationRecord | null {
    const row = db
      .prepare("SELECT * FROM run_budget_reservations WHERE run_id=?")
      .get(runId) as Row | undefined;
    return row ? mapReservation(row) : null;
  },

  resolveReservationModel(input: {
    runId: string;
    model: string;
    pricingVersion: number | null;
    inputRateMicroUsdPerMillion: number | null;
    cachedInputRateMicroUsdPerMillion: number | null;
    outputRateMicroUsdPerMillion: number | null;
    timestamp: string;
  }) {
    return db
      .prepare(
        `UPDATE run_budget_reservations
         SET model=?,pricing_version=?,input_rate_micro_usd_per_million=?,
             cached_input_rate_micro_usd_per_million=?,output_rate_micro_usd_per_million=?,updated_at=?
         WHERE run_id=? AND model='default'`,
      )
      .run(
        input.model,
        input.pricingVersion,
        input.inputRateMicroUsdPerMillion,
        input.cachedInputRateMicroUsdPerMillion,
        input.outputRateMicroUsdPerMillion,
        input.timestamp,
        input.runId,
      ).changes;
  },

  reservedExposure(start: string, end: string) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(
           CASE
             WHEN status IN ('reserved','active')
               OR (status='exceeded' AND terminal_status IS NULL)
               THEN reserved_cost_micro_usd
             WHEN actual_cost_micro_usd IS NOT NULL THEN actual_cost_micro_usd
             ELSE reserved_cost_micro_usd
           END
         ),0) AS exposure
         FROM run_budget_reservations
         WHERE status != 'rejected' AND created_at >= ? AND created_at < ?`,
      )
      .get(start, end) as Row;
    return Number(row.exposure ?? 0);
  },

  summarizeUsage(start: string | null, end: string): UsageAggregateRecord {
    const window = usageWindow(start, end);
    const row = db
      .prepare(
        `SELECT ${usageAggregateColumns}
         FROM run_budget_reservations b
         WHERE b.status != 'rejected' AND ${window.clause}`,
      )
      .get(...window.parameters) as Row;
    return mapUsageAggregate(row);
  },

  listUsageBreakdown(
    dimension: UsageBreakdownDimension,
    start: string | null,
    end: string,
    limit = 8,
  ): UsageBreakdownRecord[] {
    const window = usageWindow(start, end);
    const dimensions = {
      runtime: {
        key: "b.runtime_id",
        label: "b.runtime_id",
        context: "NULL",
        joins: "",
        group: "b.runtime_id",
      },
      model: {
        key: "b.runtime_id || char(0) || b.model",
        label: "b.model",
        context: "b.runtime_id",
        joins: "",
        group: "b.runtime_id,b.model",
      },
      agent: {
        key: "r.agent_id",
        label: "a.name",
        context: "a.role",
        joins: "JOIN runs r ON r.id=b.run_id JOIN agents a ON a.id=r.agent_id",
        group: "r.agent_id,a.name,a.role",
      },
    } as const;
    const selected = dimensions[dimension];
    return (
      db
        .prepare(
          `SELECT ${selected.key} AS breakdown_key,
                  ${selected.label} AS breakdown_label,
                  ${selected.context} AS breakdown_context,
                  ${usageAggregateColumns}
           FROM run_budget_reservations b
           ${selected.joins}
           WHERE b.status != 'rejected' AND ${window.clause}
           GROUP BY ${selected.group}
           ORDER BY (provider_cost_micro_usd + sdk_estimated_cost_micro_usd + pricing_estimated_cost_micro_usd) DESC,
                    total_tokens DESC
           LIMIT ?`,
        )
        .all(...window.parameters, limit) as Row[]
    ).map((row) => ({
      ...mapUsageAggregate(row),
      key: String(row.breakdown_key),
      label: String(row.breakdown_label),
      context: row.breakdown_context ? String(row.breakdown_context) : null,
    }));
  },

  activeReservedExposure(start: string, end: string) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(reserved_cost_micro_usd),0) AS exposure
         FROM run_budget_reservations
         WHERE (status IN ('reserved','active')
                OR (status='exceeded' AND terminal_status IS NULL))
           AND created_at >= ? AND created_at < ?`,
      )
      .get(start, end) as Row;
    return Number(row.exposure ?? 0);
  },

  insertReservation(input: {
    runId: string;
    runtimeId: string;
    model: string;
    status: string;
    policyVersion: number;
    pricingVersion: number | null;
    effectiveMaxTokens: number | null;
    effectiveMaxCostMicroUsd: number | null;
    reservedCostMicroUsd: number;
    inputRateMicroUsdPerMillion: number | null;
    cachedInputRateMicroUsdPerMillion: number | null;
    outputRateMicroUsdPerMillion: number | null;
    reason: string | null;
    timestamp: string;
  }) {
    db.prepare(
      `INSERT INTO run_budget_reservations
       (run_id,runtime_id,model,status,policy_version,pricing_version,effective_max_tokens,effective_max_cost_micro_usd,
        reserved_cost_micro_usd,input_rate_micro_usd_per_million,cached_input_rate_micro_usd_per_million,
        output_rate_micro_usd_per_million,reason,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.runId,
      input.runtimeId,
      input.model,
      input.status,
      input.policyVersion,
      input.pricingVersion,
      input.effectiveMaxTokens,
      input.effectiveMaxCostMicroUsd,
      input.reservedCostMicroUsd,
      input.inputRateMicroUsdPerMillion,
      input.cachedInputRateMicroUsdPerMillion,
      input.outputRateMicroUsdPerMillion,
      input.reason,
      input.timestamp,
      input.timestamp,
    );
  },

  insertUsageObservation(input: {
    runId: string;
    eventKey: string;
    runnerRunId: string;
    usageScope: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    providerCostMicroUsd: number | null;
    estimatedCostMicroUsd: number | null;
    costSource: string | null;
    timestamp: string;
  }) {
    return Boolean(
      db
        .prepare(
          `INSERT OR IGNORE INTO budget_usage_observations
           (run_id,event_key,runner_run_id,usage_scope,input_tokens,cached_input_tokens,output_tokens,total_tokens,
            provider_cost_micro_usd,estimated_cost_micro_usd,cost_source,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          input.runId,
          input.eventKey,
          input.runnerRunId,
          input.usageScope,
          input.inputTokens,
          input.cachedInputTokens,
          input.outputTokens,
          input.totalTokens,
          input.providerCostMicroUsd,
          input.estimatedCostMicroUsd,
          input.costSource,
          input.timestamp,
        ).changes,
    );
  },

  listUsageObservations(runId: string): UsageObservationRecord[] {
    return (
      db
        .prepare(
          "SELECT * FROM budget_usage_observations WHERE run_id=? ORDER BY rowid",
        )
        .all(runId) as Row[]
    ).map((row) => ({
      runnerRunId: String(row.runner_run_id),
      usageScope: String(row.usage_scope),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      providerCostMicroUsd: nullableNumber(row.provider_cost_micro_usd),
      estimatedCostMicroUsd: nullableNumber(row.estimated_cost_micro_usd),
      costSource: row.cost_source ? String(row.cost_source) : null,
    }));
  },

  updateReservationUsage(input: {
    runId: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    calculatedCostMicroUsd: number | null;
    providerCostMicroUsd: number | null;
    estimatedCostMicroUsd: number | null;
    actualCostMicroUsd: number | null;
    actualCostSource: string;
    reason: string | null;
    timestamp: string;
  }) {
    db.prepare(
      `UPDATE run_budget_reservations SET actual_input_tokens=?,actual_cached_input_tokens=?,actual_output_tokens=?,actual_total_tokens=?,
       calculated_cost_micro_usd=?,provider_cost_micro_usd=?,estimated_cost_micro_usd=?,actual_cost_micro_usd=?,actual_cost_source=?,
       status=CASE WHEN ? IS NULL THEN status ELSE 'exceeded' END,
       reason=COALESCE(?,reason),exceeded_at=CASE WHEN ? IS NULL THEN exceeded_at ELSE COALESCE(exceeded_at,?) END,updated_at=? WHERE run_id=?`,
    ).run(
      input.inputTokens,
      input.cachedInputTokens,
      input.outputTokens,
      input.totalTokens,
      input.calculatedCostMicroUsd,
      input.providerCostMicroUsd,
      input.estimatedCostMicroUsd,
      input.actualCostMicroUsd,
      input.actualCostSource,
      input.reason,
      input.reason,
      input.reason,
      input.timestamp,
      input.timestamp,
      input.runId,
    );
  },

  markReservationExceeded(runId: string, timestamp: string) {
    db.prepare(
      `UPDATE run_budget_reservations SET status='exceeded',reason=COALESCE(reason,'runtime_budget_exceeded'),
       exceeded_at=COALESCE(exceeded_at,?),updated_at=? WHERE run_id=?`,
    ).run(timestamp, timestamp, runId);
  },

  settleReservation(runId: string, terminalStatus: string, timestamp: string) {
    db.prepare(
      `UPDATE run_budget_reservations SET status=CASE WHEN status='exceeded' THEN status WHEN status='rejected' THEN status ELSE 'settled' END,
       terminal_status=?,settled_at=COALESCE(settled_at,?),updated_at=? WHERE run_id=?`,
    ).run(terminalStatus, timestamp, timestamp, runId);
  },

  releaseReservationWithoutRuntime(
    runId: string,
    terminalStatus: string,
    timestamp: string,
  ) {
    db.prepare(
      `UPDATE run_budget_reservations SET status=CASE WHEN status='rejected' THEN status ELSE 'settled' END,
       terminal_status=?,actual_input_tokens=0,actual_cached_input_tokens=0,actual_output_tokens=0,actual_total_tokens=0,
       calculated_cost_micro_usd=0,provider_cost_micro_usd=NULL,estimated_cost_micro_usd=NULL,actual_cost_micro_usd=0,actual_cost_source='no_usage',
       settled_at=COALESCE(settled_at,?),updated_at=? WHERE run_id=?`,
    ).run(terminalStatus, timestamp, timestamp, runId);
  },
};
