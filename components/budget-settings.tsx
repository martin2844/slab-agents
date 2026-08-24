"use client";

import { useState } from "react";
import { CircleDollarSign, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client-api";
import type {
  Agent,
  BudgetConfiguration,
  RuntimeCatalogItem,
  RuntimeModelPrice,
} from "@/lib/types";

const nullable = (value: string) => (value.trim() ? Number(value) : null);
const value = (input: number | null) => (input === null ? "" : String(input));

export function BudgetSettings({
  initialBudget,
  agents,
  runtimes,
}: {
  initialBudget: BudgetConfiguration;
  agents: Agent[];
  runtimes: RuntimeCatalogItem[];
}) {
  const [budget, setBudget] = useState(initialBudget);
  const [busy, setBusy] = useState(false);

  function workspaceField(
    field: keyof Omit<BudgetConfiguration["workspace"], "version">,
    next: string,
  ) {
    setBudget((current) => ({
      ...current,
      workspace: { ...current.workspace, [field]: nullable(next) },
    }));
  }

  function agentField(
    agentId: string,
    field: "maxTokensPerRun" | "maxCostUsdPerRun",
    next: string,
  ) {
    setBudget((current) => {
      const existing = current.agents.find((item) => item.agentId === agentId);
      const policy = {
        agentId,
        maxTokensPerRun: existing?.maxTokensPerRun ?? null,
        maxCostUsdPerRun: existing?.maxCostUsdPerRun ?? null,
        [field]: nullable(next),
      };
      return {
        ...current,
        agents: [
          ...current.agents.filter((item) => item.agentId !== agentId),
          policy,
        ],
      };
    });
  }

  function priceField(
    index: number,
    field: keyof Omit<RuntimeModelPrice, "version">,
    next: string,
  ) {
    setBudget((current) => ({
      ...current,
      prices: current.prices.map((price, itemIndex) =>
        itemIndex === index
          ? {
              ...price,
              [field]:
                field === "runtimeId" || field === "model"
                  ? next
                  : Number(next),
            }
          : price,
      ),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const next = await api<BudgetConfiguration>("/api/budget", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: budget.workspace.version,
          workspace: {
            maxTokensPerRun: budget.workspace.maxTokensPerRun,
            maxCostUsdPerRun: budget.workspace.maxCostUsdPerRun,
            dailyCostUsd: budget.workspace.dailyCostUsd,
            monthlyCostUsd: budget.workspace.monthlyCostUsd,
          },
          agents: budget.agents.filter(
            (policy) =>
              policy.maxTokensPerRun !== null ||
              policy.maxCostUsdPerRun !== null,
          ),
          prices: budget.prices.map((price) => ({
            runtimeId: price.runtimeId,
            model: price.model,
            inputUsdPerMillion: price.inputUsdPerMillion,
            cachedInputUsdPerMillion: price.cachedInputUsdPerMillion,
            outputUsdPerMillion: price.outputUsdPerMillion,
          })),
        }),
      });
      setBudget(next);
      toast.success("Budget policy saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save budget policy",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 rounded-md border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="flex gap-3">
          <CircleDollarSign className="mt-0.5 size-4" />
          <div>
            <h3 className="text-sm font-semibold">Run and workspace budgets</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Empty fields are unlimited. Daily and monthly accounting use UTC.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={busy}>
          <Save /> Save budgets
        </Button>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <BudgetInput
          label="Tokens / run"
          value={value(budget.workspace.maxTokensPerRun)}
          onChange={(next) => workspaceField("maxTokensPerRun", next)}
        />
        <BudgetInput
          label="USD / run"
          value={value(budget.workspace.maxCostUsdPerRun)}
          onChange={(next) => workspaceField("maxCostUsdPerRun", next)}
        />
        <BudgetInput
          label="USD / day"
          value={value(budget.workspace.dailyCostUsd)}
          onChange={(next) => workspaceField("dailyCostUsd", next)}
        />
        <BudgetInput
          label="USD / month"
          value={value(budget.workspace.monthlyCostUsd)}
          onChange={(next) => workspaceField("monthlyCostUsd", next)}
        />
      </div>

      {agents.length ? (
        <div className="border-t p-4">
          <h4 className="text-xs font-semibold">Stricter agent overrides</h4>
          <div className="mt-3 divide-y rounded-md border">
            {agents.map((agent) => {
              const policy = budget.agents.find(
                (item) => item.agentId === agent.id,
              );
              return (
                <div
                  key={agent.id}
                  className="grid gap-3 p-3 sm:grid-cols-[minmax(8rem,1fr)_11rem_11rem] sm:items-end"
                >
                  <div className="text-sm font-semibold">{agent.name}</div>
                  <BudgetInput
                    label="Tokens / run"
                    value={value(policy?.maxTokensPerRun ?? null)}
                    onChange={(next) =>
                      agentField(agent.id, "maxTokensPerRun", next)
                    }
                  />
                  <BudgetInput
                    label="USD / run"
                    value={value(policy?.maxCostUsdPerRun ?? null)}
                    onChange={(next) =>
                      agentField(agent.id, "maxCostUsdPerRun", next)
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="border-t p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-semibold">Operator pricing catalog</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Required for USD enforcement when a runtime does not report native
              cost. Codex subscription runs never receive an invented dollar
              cost.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setBudget((current) => ({
                ...current,
                prices: [
                  ...current.prices,
                  {
                    runtimeId: runtimes[0]?.id ?? "codex",
                    model: "default",
                    version: 1,
                    inputUsdPerMillion: 0,
                    cachedInputUsdPerMillion: 0,
                    outputUsdPerMillion: 0,
                  },
                ],
              }))
            }
          >
            <Plus /> Add price
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {budget.prices.map((price, index) => (
            <div
              key={`${price.runtimeId}:${price.model}:${index}`}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[9rem_1fr_repeat(3,9rem)_auto] md:items-end"
            >
              <BudgetInput
                label="Runtime"
                type="text"
                value={price.runtimeId}
                onChange={(next) => priceField(index, "runtimeId", next)}
              />
              <BudgetInput
                label="Model"
                type="text"
                value={price.model}
                onChange={(next) => priceField(index, "model", next)}
              />
              <BudgetInput
                label="Input / 1M"
                value={String(price.inputUsdPerMillion)}
                onChange={(next) =>
                  priceField(index, "inputUsdPerMillion", next)
                }
              />
              <BudgetInput
                label="Cached / 1M"
                value={String(price.cachedInputUsdPerMillion)}
                onChange={(next) =>
                  priceField(index, "cachedInputUsdPerMillion", next)
                }
              />
              <BudgetInput
                label="Output / 1M"
                value={String(price.outputUsdPerMillion)}
                onChange={(next) =>
                  priceField(index, "outputUsdPerMillion", next)
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove price"
                onClick={() =>
                  setBudget((current) => ({
                    ...current,
                    prices: current.prices.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  }))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BudgetInput({
  label,
  value,
  onChange,
  type = "number",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "number" | "text";
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold">
      {label}
      <Input
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        value={value}
        placeholder="Unlimited"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
