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
} from "@/lib/types";

type WorkspaceDraft = Record<
  keyof Omit<BudgetConfiguration["workspace"], "version">,
  string
>;
type AgentDraft = {
  maxTokensPerRun: string;
  maxCostUsdPerRun: string;
};
type PriceDraft = {
  clientId: string;
  runtimeId: string;
  model: string;
  inputUsdPerMillion: string;
  cachedInputUsdPerMillion: string;
  outputUsdPerMillion: string;
};
type BudgetDraft = {
  workspace: WorkspaceDraft;
  agents: Record<string, AgentDraft>;
  prices: PriceDraft[];
};

const value = (input: number | null) => (input === null ? "" : String(input));

function draftFromConfiguration(
  configuration: BudgetConfiguration,
): BudgetDraft {
  return {
    workspace: {
      maxTokensPerRun: value(configuration.workspace.maxTokensPerRun),
      maxCostUsdPerRun: value(configuration.workspace.maxCostUsdPerRun),
      dailyCostUsd: value(configuration.workspace.dailyCostUsd),
      monthlyCostUsd: value(configuration.workspace.monthlyCostUsd),
    },
    agents: Object.fromEntries(
      configuration.agents.map((policy) => [
        policy.agentId,
        {
          maxTokensPerRun: value(policy.maxTokensPerRun),
          maxCostUsdPerRun: value(policy.maxCostUsdPerRun),
        },
      ]),
    ),
    prices: configuration.prices.map((price, index) => ({
      clientId: `saved:${price.runtimeId}:${price.model}:${index}`,
      runtimeId: price.runtimeId,
      model: price.model,
      inputUsdPerMillion: String(price.inputUsdPerMillion),
      cachedInputUsdPerMillion: String(price.cachedInputUsdPerMillion),
      outputUsdPerMillion: String(price.outputUsdPerMillion),
    })),
  };
}

function nullableNumber(input: string, label: string) {
  if (!input.trim()) return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function requiredNumber(input: string, label: string) {
  const parsed = Number(input);
  if (!input.trim() || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
  }
  return parsed;
}

export function BudgetSettings({
  initialBudget,
  agents,
  runtimes,
}: {
  initialBudget: BudgetConfiguration;
  agents: Agent[];
  runtimes: RuntimeCatalogItem[];
}) {
  const [configuration, setConfiguration] = useState(initialBudget);
  const [draft, setDraft] = useState(() =>
    draftFromConfiguration(initialBudget),
  );
  const [busy, setBusy] = useState(false);

  function workspaceField(
    field: keyof Omit<BudgetConfiguration["workspace"], "version">,
    next: string,
  ) {
    setDraft((current) => ({
      ...current,
      workspace: { ...current.workspace, [field]: next },
    }));
  }

  function agentField(
    agentId: string,
    field: "maxTokensPerRun" | "maxCostUsdPerRun",
    next: string,
  ) {
    setDraft((current) => ({
      ...current,
      agents: {
        ...current.agents,
        [agentId]: {
          maxTokensPerRun: current.agents[agentId]?.maxTokensPerRun ?? "",
          maxCostUsdPerRun: current.agents[agentId]?.maxCostUsdPerRun ?? "",
          [field]: next,
        },
      },
    }));
  }

  function priceField(
    clientId: string,
    field: Exclude<keyof PriceDraft, "clientId">,
    next: string,
  ) {
    setDraft((current) => ({
      ...current,
      prices: current.prices.map((price) =>
        price.clientId === clientId ? { ...price, [field]: next } : price,
      ),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const next = await api<BudgetConfiguration>("/api/budget", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: configuration.workspace.version,
          workspace: {
            maxTokensPerRun: nullableNumber(
              draft.workspace.maxTokensPerRun,
              "Run token limit",
            ),
            maxCostUsdPerRun: nullableNumber(
              draft.workspace.maxCostUsdPerRun,
              "Run cost limit",
            ),
            dailyCostUsd: nullableNumber(
              draft.workspace.dailyCostUsd,
              "Daily cost limit",
            ),
            monthlyCostUsd: nullableNumber(
              draft.workspace.monthlyCostUsd,
              "Monthly cost limit",
            ),
          },
          agents: Object.entries(draft.agents)
            .map(([agentId, policy]) => ({
              agentId,
              maxTokensPerRun: nullableNumber(
                policy.maxTokensPerRun,
                "Agent token limit",
              ),
              maxCostUsdPerRun: nullableNumber(
                policy.maxCostUsdPerRun,
                "Agent cost limit",
              ),
            }))
            .filter(
              (policy) =>
                policy.maxTokensPerRun !== null ||
                policy.maxCostUsdPerRun !== null,
            ),
          prices: draft.prices.map((price) => ({
            runtimeId: price.runtimeId,
            model: price.model,
            inputUsdPerMillion: requiredNumber(
              price.inputUsdPerMillion,
              "Input price",
            ),
            cachedInputUsdPerMillion: requiredNumber(
              price.cachedInputUsdPerMillion,
              "Cached input price",
            ),
            outputUsdPerMillion: requiredNumber(
              price.outputUsdPerMillion,
              "Output price",
            ),
          })),
        }),
      });
      setConfiguration(next);
      setDraft(draftFromConfiguration(next));
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
          value={draft.workspace.maxTokensPerRun}
          onChange={(next) => workspaceField("maxTokensPerRun", next)}
        />
        <BudgetInput
          label="USD / run"
          value={draft.workspace.maxCostUsdPerRun}
          onChange={(next) => workspaceField("maxCostUsdPerRun", next)}
        />
        <BudgetInput
          label="USD / day"
          value={draft.workspace.dailyCostUsd}
          onChange={(next) => workspaceField("dailyCostUsd", next)}
        />
        <BudgetInput
          label="USD / month"
          value={draft.workspace.monthlyCostUsd}
          onChange={(next) => workspaceField("monthlyCostUsd", next)}
        />
      </div>

      {agents.length ? (
        <div className="border-t p-4">
          <h4 className="text-xs font-semibold">Stricter agent overrides</h4>
          <div className="mt-3 divide-y rounded-md border">
            {agents.map((agent) => {
              const policy = draft.agents[agent.id];
              return (
                <div
                  key={agent.id}
                  className="grid gap-3 p-3 sm:grid-cols-[minmax(8rem,1fr)_11rem_11rem] sm:items-end"
                >
                  <div className="text-sm font-semibold">{agent.name}</div>
                  <BudgetInput
                    label="Tokens / run"
                    value={policy?.maxTokensPerRun ?? ""}
                    onChange={(next) =>
                      agentField(agent.id, "maxTokensPerRun", next)
                    }
                  />
                  <BudgetInput
                    label="USD / run"
                    value={policy?.maxCostUsdPerRun ?? ""}
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
              setDraft((current) => ({
                ...current,
                prices: [
                  ...current.prices,
                  {
                    clientId: `new:${Date.now()}:${current.prices.length}`,
                    runtimeId: runtimes[0]?.id ?? "codex",
                    model: "default",
                    inputUsdPerMillion: "0",
                    cachedInputUsdPerMillion: "0",
                    outputUsdPerMillion: "0",
                  },
                ],
              }))
            }
          >
            <Plus /> Add price
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {draft.prices.map((price) => (
            <div
              key={price.clientId}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[9rem_1fr_repeat(3,9rem)_auto] md:items-end"
            >
              <BudgetInput
                label="Runtime"
                type="text"
                value={price.runtimeId}
                onChange={(next) =>
                  priceField(price.clientId, "runtimeId", next)
                }
              />
              <BudgetInput
                label="Model"
                type="text"
                value={price.model}
                onChange={(next) => priceField(price.clientId, "model", next)}
              />
              <BudgetInput
                label="Input / 1M"
                value={price.inputUsdPerMillion}
                onChange={(next) =>
                  priceField(price.clientId, "inputUsdPerMillion", next)
                }
              />
              <BudgetInput
                label="Cached / 1M"
                value={price.cachedInputUsdPerMillion}
                onChange={(next) =>
                  priceField(price.clientId, "cachedInputUsdPerMillion", next)
                }
              />
              <BudgetInput
                label="Output / 1M"
                value={price.outputUsdPerMillion}
                onChange={(next) =>
                  priceField(price.clientId, "outputUsdPerMillion", next)
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove price"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    prices: current.prices.filter(
                      (item) => item.clientId !== price.clientId,
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
