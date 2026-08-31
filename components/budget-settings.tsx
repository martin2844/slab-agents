"use client";

import { useState } from "react";
import { ChevronRight, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client-api";
import {
  SettingRow,
  SettingSection,
  settingControlWidths,
} from "@/components/settings-layout";
import type {
  Agent,
  BudgetConfiguration,
  RuntimeCatalogItem,
  RuntimeModelPrice,
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
const priceKey = (runtimeId: string, model: string) =>
  `${runtimeId}\u0000${model}`;

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

  function overrideDefault(price: RuntimeModelPrice) {
    const key = priceKey(price.runtimeId, price.model);
    setDraft((current) => {
      if (
        current.prices.some(
          (candidate) => priceKey(candidate.runtimeId, candidate.model) === key,
        )
      ) {
        return current;
      }
      return {
        ...current,
        prices: [
          ...current.prices,
          {
            clientId: `default:${price.runtimeId}:${price.model}`,
            runtimeId: price.runtimeId,
            model: price.model,
            inputUsdPerMillion: String(price.inputUsdPerMillion),
            cachedInputUsdPerMillion: String(price.cachedInputUsdPerMillion),
            outputUsdPerMillion: String(price.outputUsdPerMillion),
          },
        ],
      };
    });
  }

  function removePrice(clientId: string) {
    setDraft((current) => ({
      ...current,
      prices: current.prices.filter((price) => price.clientId !== clientId),
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

  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(draftFromConfiguration(configuration));
  const overrideByPrice = new Map(
    draft.prices.map((price) => [
      priceKey(price.runtimeId, price.model),
      price,
    ]),
  );
  const bundledPriceKeys = new Set(
    configuration.defaultPrices.map((price) =>
      priceKey(price.runtimeId, price.model),
    ),
  );
  const customPrices = draft.prices.filter(
    (price) => !bundledPriceKeys.has(priceKey(price.runtimeId, price.model)),
  );

  return (
    <div className="space-y-7">
      <SettingSection
        title="Usage limits"
        description="Empty fields are unlimited. Daily and monthly accounting use UTC."
      >
        <SettingRow
          title="Workspace budget"
          description="Limits applied unless an agent has a stricter override."
        >
          <div className="grid max-w-[32rem] gap-3 sm:grid-cols-2">
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
        </SettingRow>
      </SettingSection>

      {agents.length ? (
        <SettingSection title="Agent overrides">
          <SettingRow
            title="Stricter per-agent limits"
            description={`${agents.length} agents available. Empty values inherit workspace limits.`}
          >
            <details className="group rounded-md bg-muted px-3">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-xs font-semibold [&::-webkit-details-marker]:hidden">
                Manage overrides
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              </summary>
              <div className="divide-y border-t pb-2">
                {agents.map((agent) => {
                  const policy = draft.agents[agent.id];
                  return (
                    <div
                      key={agent.id}
                      className="grid gap-3 py-3 sm:grid-cols-[minmax(8rem,1fr)_11rem_11rem] sm:items-end"
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
            </details>
          </SettingRow>
        </SettingSection>
      ) : null}

      <SettingSection
        title="Advanced runtime configuration"
        description="Default API-equivalent estimates, with local operator overrides."
      >
        <SettingRow
          title="Model pricing catalog"
          description="Provider-reported cost wins. Subscription runtimes such as Codex use API-equivalent estimates, not the subscription invoice."
          layout="wide"
        >
          <details className="group rounded-md bg-muted px-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-xs font-semibold [&::-webkit-details-marker]:hidden">
              {configuration.defaultPrices.length} defaults ·{" "}
              {draft.prices.length} operator override
              {draft.prices.length === 1 ? "" : "s"}
              <ChevronRight className="ml-auto size-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="space-y-5 border-t pb-3 pt-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    Bundled pricing defaults
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {configuration.pricingCatalog.name} snapshot ·{" "}
                    {configuration.pricingCatalog.snapshotDate}. Rates are USD
                    per 1M tokens.
                  </p>
                </div>
                <a
                  className="text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  href={configuration.pricingCatalog.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source
                </a>
              </div>

              <div className="space-y-2">
                {configuration.defaultPrices.map((price) => {
                  const override = overrideByPrice.get(
                    priceKey(price.runtimeId, price.model),
                  );
                  return (
                    <DefaultPriceRow
                      key={priceKey(price.runtimeId, price.model)}
                      price={price}
                      override={override}
                      onOverride={() => overrideDefault(price)}
                      onChange={priceField}
                      onReset={() => {
                        if (override) removePrice(override.clientId);
                      }}
                    />
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <div>
                  <p className="text-sm font-semibold">Custom overrides</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Add private models or replace a provider default.
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
                          runtimeId:
                            runtimes.find(({ id }) => id === "direct_api")
                              ?.id ?? "direct_api",
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
              <div className="space-y-2">
                {customPrices.map((price) => (
                  <div
                    key={price.clientId}
                    className="grid gap-2 rounded-md border bg-card p-3 md:grid-cols-[9rem_1fr_repeat(3,9rem)_auto] md:items-end"
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
                      onChange={(next) =>
                        priceField(price.clientId, "model", next)
                      }
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
                        priceField(
                          price.clientId,
                          "cachedInputUsdPerMillion",
                          next,
                        )
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
                      onClick={() => removePrice(price.clientId)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {customPrices.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                    No custom model prices.
                  </p>
                ) : null}
              </div>
            </div>
          </details>
        </SettingRow>
      </SettingSection>

      {dirty ? (
        <div className="sticky bottom-4 z-20 flex justify-center">
          <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-lg border bg-primary px-3 py-2 text-primary-foreground shadow-lg">
            <span className="text-sm font-medium">Unsaved budget changes</span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
                onClick={() => setDraft(draftFromConfiguration(configuration))}
              >
                Discard
              </Button>
              <Button variant="signal" onClick={save} disabled={busy}>
                <Save /> Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DefaultPriceRow({
  price,
  override,
  onOverride,
  onChange,
  onReset,
}: {
  price: RuntimeModelPrice;
  override: PriceDraft | undefined;
  onOverride: () => void;
  onChange: (
    clientId: string,
    field: Exclude<keyof PriceDraft, "clientId">,
    value: string,
  ) => void;
  onReset: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border bg-card p-3 md:grid-cols-[9rem_1fr_repeat(3,9rem)_auto] md:items-end">
      <div className="grid gap-1 text-xs font-semibold">
        Runtime
        <span className="flex h-9 items-center font-mono font-normal">
          {price.runtimeId}
        </span>
      </div>
      <div className="grid gap-1 text-xs font-semibold">
        Model
        <span className="flex h-9 items-center font-mono font-normal">
          {price.model}
        </span>
      </div>
      {override ? (
        <>
          <BudgetInput
            label="Input / 1M"
            value={override.inputUsdPerMillion}
            onChange={(value) =>
              onChange(override.clientId, "inputUsdPerMillion", value)
            }
          />
          <BudgetInput
            label="Cached / 1M"
            value={override.cachedInputUsdPerMillion}
            onChange={(value) =>
              onChange(override.clientId, "cachedInputUsdPerMillion", value)
            }
          />
          <BudgetInput
            label="Output / 1M"
            value={override.outputUsdPerMillion}
            onChange={(value) =>
              onChange(override.clientId, "outputUsdPerMillion", value)
            }
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Reset ${price.model} to bundled pricing`}
            title="Reset to bundled pricing"
            onClick={onReset}
          >
            <RotateCcw />
          </Button>
        </>
      ) : (
        <>
          <DefaultRate label="Input / 1M" value={price.inputUsdPerMillion} />
          <DefaultRate
            label="Cached / 1M"
            value={price.cachedInputUsdPerMillion}
          />
          <DefaultRate label="Output / 1M" value={price.outputUsdPerMillion} />
          <Button size="xs" variant="ghost" onClick={onOverride}>
            Override
          </Button>
        </>
      )}
    </div>
  );
}

function DefaultRate({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 text-xs font-semibold">
      {label}
      <span className="flex h-9 items-center font-mono font-normal">
        ${value}
      </span>
    </div>
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
        className={settingControlWidths.compact}
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
