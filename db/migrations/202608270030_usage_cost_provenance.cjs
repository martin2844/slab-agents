function number(value) {
  return value === null || value === undefined ? 0 : Number(value);
}

/** @param {import("knex").Knex} knex */
async function reconcileHistoricalUsage(knex) {
  const observations = await knex("budget_usage_observations")
    .select("*", knex.raw("rowid AS observation_order"))
    .orderBy("observation_order");
  const byRun = new Map();
  for (const observation of observations) {
    const run = byRun.get(observation.run_id) ?? new Map();
    const execution = run.get(observation.runner_run_id) ?? [];
    execution.push(observation);
    run.set(observation.runner_run_id, execution);
    byRun.set(observation.run_id, run);
  }
  const reservations = new Map(
    (await knex("run_budget_reservations").select("*")).map((reservation) => [
      reservation.run_id,
      reservation,
    ]),
  );

  for (const [runId, executions] of byRun) {
    const selected = [...executions.values()].flatMap((execution) => {
      const aggregates = execution.filter(
        (row) => row.usage_scope === "run_aggregate",
      );
      return aggregates.length ? [aggregates.at(-1)] : execution;
    });
    const totals = selected.reduce(
      (sum, row) => ({
        input: sum.input + number(row.input_tokens),
        cached: sum.cached + number(row.cached_input_tokens),
        output: sum.output + number(row.output_tokens),
        total: sum.total + number(row.total_tokens),
        provider: sum.provider + number(row.provider_cost_micro_usd),
        estimated: sum.estimated + number(row.estimated_cost_micro_usd),
        hasProvider: sum.hasProvider || row.provider_cost_micro_usd !== null,
        hasEstimated: sum.hasEstimated || row.estimated_cost_micro_usd !== null,
      }),
      {
        input: 0,
        cached: 0,
        output: 0,
        total: 0,
        provider: 0,
        estimated: 0,
        hasProvider: false,
        hasEstimated: false,
      },
    );
    const reservation = reservations.get(runId);
    if (!reservation) continue;
    const calculated =
      reservation.pricing_version === null ||
      reservation.pricing_version === undefined
        ? null
        : Math.ceil(
            (Math.max(0, totals.input - totals.cached) *
              number(reservation.input_rate_micro_usd_per_million) +
              totals.cached *
                number(reservation.cached_input_rate_micro_usd_per_million) +
              totals.output *
                number(reservation.output_rate_micro_usd_per_million)) /
              1_000_000,
          );
    const source = totals.hasProvider
      ? "provider_reported"
      : totals.hasEstimated
        ? "sdk_estimated"
        : totals.total === 0
          ? "no_usage"
          : calculated !== null
            ? "pricing_snapshot"
            : "unpriced";
    const actual = totals.hasProvider
      ? totals.provider
      : totals.hasEstimated
        ? totals.estimated
        : totals.total === 0
          ? 0
          : calculated;
    await knex("run_budget_reservations")
      .where({ run_id: runId })
      .update({
        actual_input_tokens: totals.input,
        actual_cached_input_tokens: totals.cached,
        actual_output_tokens: totals.output,
        actual_total_tokens: totals.total,
        calculated_cost_micro_usd: calculated,
        provider_cost_micro_usd: totals.hasProvider ? totals.provider : null,
        estimated_cost_micro_usd:
          source === "sdk_estimated"
            ? totals.estimated
            : source === "pricing_snapshot"
              ? calculated
              : null,
        actual_cost_micro_usd: actual,
        actual_cost_source: source,
      });
  }
}

/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable("budget_usage_observations", (table) => {
    table.text("runner_run_id");
    table.text("cost_source");
    table.bigInteger("estimated_cost_micro_usd");
  });
  await knex.schema.alterTable("run_budget_reservations", (table) => {
    table.text("actual_cost_source");
    table.bigInteger("estimated_cost_micro_usd");
  });

  await knex.raw(`
    UPDATE budget_usage_observations
    SET runner_run_id = CASE
      WHEN instr(event_key, ':') > 0 THEN substr(event_key, 1, instr(event_key, ':') - 1)
      ELSE event_key
    END
  `);
  await knex.raw(`
    UPDATE budget_usage_observations
    SET cost_source = CASE
          WHEN (SELECT runtime_id FROM run_budget_reservations
                WHERE run_id = budget_usage_observations.run_id) = 'claude'
            THEN 'sdk_estimated'
          ELSE 'provider_reported'
        END,
        estimated_cost_micro_usd = CASE
          WHEN (SELECT runtime_id FROM run_budget_reservations
                WHERE run_id = budget_usage_observations.run_id) = 'claude'
            THEN provider_cost_micro_usd
          ELSE NULL
        END,
        provider_cost_micro_usd = CASE
          WHEN (SELECT runtime_id FROM run_budget_reservations
                WHERE run_id = budget_usage_observations.run_id) = 'claude'
            THEN NULL
          ELSE provider_cost_micro_usd
        END
    WHERE provider_cost_micro_usd IS NOT NULL
  `);
  await knex.raw(`
    UPDATE run_budget_reservations
    SET actual_cost_source = CASE
          WHEN runtime_id = 'claude' AND provider_cost_micro_usd IS NOT NULL
            THEN 'sdk_estimated'
          WHEN provider_cost_micro_usd IS NOT NULL THEN 'provider_reported'
          WHEN calculated_cost_micro_usd IS NOT NULL THEN 'pricing_snapshot'
          WHEN actual_total_tokens > 0 THEN 'unpriced'
          ELSE NULL
        END,
        estimated_cost_micro_usd = CASE
          WHEN runtime_id = 'claude' THEN provider_cost_micro_usd
          WHEN provider_cost_micro_usd IS NULL THEN calculated_cost_micro_usd
          ELSE NULL
        END,
        provider_cost_micro_usd = CASE
          WHEN runtime_id = 'claude' THEN NULL
          ELSE provider_cost_micro_usd
        END
  `);
  await reconcileHistoricalUsage(knex);
};

/** @param {import("knex").Knex} knex */
exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE run_budget_reservations
    SET provider_cost_micro_usd = COALESCE(
      provider_cost_micro_usd,
      estimated_cost_micro_usd
    )
    WHERE actual_cost_source = 'sdk_estimated'
  `);
  await knex.raw(`
    UPDATE budget_usage_observations
    SET provider_cost_micro_usd = COALESCE(
      provider_cost_micro_usd,
      estimated_cost_micro_usd
    )
    WHERE cost_source = 'sdk_estimated'
  `);
  await knex.schema.alterTable("run_budget_reservations", (table) => {
    table.dropColumn("estimated_cost_micro_usd");
    table.dropColumn("actual_cost_source");
  });
  await knex.schema.alterTable("budget_usage_observations", (table) => {
    table.dropColumn("estimated_cost_micro_usd");
    table.dropColumn("cost_source");
    table.dropColumn("runner_run_id");
  });
};
