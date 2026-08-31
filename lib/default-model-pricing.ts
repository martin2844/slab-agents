import type { RuntimeModelPrice } from "@/lib/types";

const DEFAULT_PRICING_VERSION = 2_026_083_001;

export const defaultPricingCatalog = {
  id: "codeburn-litellm-snapshot",
  name: "CodeBurn / LiteLLM",
  version: DEFAULT_PRICING_VERSION,
  snapshotDate: "2026-08-30",
  snapshotCommit: "6a3fa2d0ceb965baa842354dfcf8dae3eac55a1c",
  sourceUrl:
    "https://github.com/getagentseal/codeburn/blob/6a3fa2d0ceb965baa842354dfcf8dae3eac55a1c/src/data/litellm-snapshot.json",
} as const;

type CatalogPrice = Omit<RuntimeModelPrice, "version">;

// Slab intentionally ships only prices it can apply without guessing the
// provider or billing contract. OpenRouter reports its own routed cost, while
// Codex and Gemini are runtime-owned subscriptions. Unknown or private Direct
// API models remain unpriced until the operator adds an override.
const defaultPrices: CatalogPrice[] = [
  directApi("gpt-5.5", 5, 0.5, 30),
  directApi("gpt-5.4", 2.5, 0.25, 15),
  directApi("gpt-5.4-mini", 0.75, 0.075, 4.5),
  directApi("gpt-5.4-nano", 0.2, 0.02, 1.25),
  directApi("gpt-5", 1.25, 0.125, 10),
  directApi("gpt-5-mini", 0.25, 0.025, 2),
  directApi("gpt-5-nano", 0.05, 0.005, 0.4),
  claude("claude-opus-4-6", 5, 0.5, 25),
  claude("claude-sonnet-4-6", 3, 0.3, 15),
  claude("claude-haiku-4-5", 1, 0.1, 5),
  claude("claude-opus-4-5", 5, 0.5, 25),
  claude("claude-sonnet-4-5", 3, 0.3, 15),
  claude("claude-sonnet-4-20250514", 3, 0.3, 15),
];

function directApi(
  model: string,
  inputUsdPerMillion: number,
  cachedInputUsdPerMillion: number,
  outputUsdPerMillion: number,
): CatalogPrice {
  return {
    runtimeId: "direct_api",
    model,
    inputUsdPerMillion,
    cachedInputUsdPerMillion,
    outputUsdPerMillion,
  };
}

function claude(
  model: string,
  inputUsdPerMillion: number,
  cachedInputUsdPerMillion: number,
  outputUsdPerMillion: number,
): CatalogPrice {
  return {
    runtimeId: "claude",
    model,
    inputUsdPerMillion,
    cachedInputUsdPerMillion,
    outputUsdPerMillion,
  };
}

export function listDefaultModelPrices(): RuntimeModelPrice[] {
  return defaultPrices.map((price) => ({
    ...price,
    version: defaultPricingCatalog.version,
  }));
}

export function findDefaultModelPrice(
  runtimeId: string,
  model: string,
): RuntimeModelPrice | null {
  const price = defaultPrices.find(
    (candidate) =>
      candidate.runtimeId === runtimeId && candidate.model === model,
  );
  return price ? { ...price, version: defaultPricingCatalog.version } : null;
}
