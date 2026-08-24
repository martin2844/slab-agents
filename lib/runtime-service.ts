import "server-only";

import { decryptLocalSecret } from "@/lib/secrets";
import {
  getRuntimeConfig,
  runtimeIds,
  saveRuntimeConfiguration,
  type RuntimeId,
} from "@/lib/runtime-config";
import {
  listRunnerRuntimes,
  testCodexRuntime,
  type RunnerRuntimeSummary,
} from "@/lib/runner";
import { repository } from "@/lib/repository";
import type { RuntimeCatalogItem } from "@/lib/types";

const fallbackDefinitions: Record<
  RuntimeId,
  Pick<
    RuntimeCatalogItem,
    "id" | "displayName" | "stability" | "authModes" | "capabilities"
  >
> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    stability: "stable",
    authModes: ["chatgpt", "api_key", "cloud_provider"],
    capabilities: {},
  },
  claude: {
    id: "claude",
    displayName: "Claude Agent",
    stability: "experimental",
    authModes: ["api_key"],
    capabilities: {},
  },
};

class RuntimeConfigurationChangedError extends Error {
  constructor() {
    super("Runtime configuration changed while the test was running. Test it again.");
  }
}

function catalogItem(
  runtimeId: RuntimeId,
  runner: RunnerRuntimeSummary | null,
): RuntimeCatalogItem {
  const config = getRuntimeConfig(runtimeId);
  const definition = runner ?? fallbackDefinitions[runtimeId];
  const configured =
    runtimeId === "codex" || Boolean(config.credentialCiphertext);
  let health: RuntimeCatalogItem["health"] = "not_tested";
  let healthDetail = "Runtime has not been verified.";

  if (!runner) {
    health = "unavailable";
    healthDetail = "The connected Runner does not provide this runtime.";
  } else if (runtimeId === "codex") {
    health = runner.status;
    healthDetail = runner.available
      ? "Authenticated in slab-runner."
      : runner.status === "authentication_required"
        ? "Authenticate Codex with sudo slabctl codex login."
        : "Codex is unavailable in slab-runner.";
  } else if (runner.status === "unavailable") {
    health = "unavailable";
    healthDetail = "Claude is unavailable in slab-runner.";
  } else if (!configured) {
    health = "authentication_required";
    healthDetail = "Add an Anthropic API key, then test the runtime.";
  } else if (config.lastVerificationStatus === "connected") {
    health = "available";
    healthDetail =
      config.lastVerificationDetail ?? "Anthropic API key verified.";
  } else if (config.lastVerificationStatus === "failed") {
    health = "unavailable";
    healthDetail =
      config.lastVerificationDetail ?? "Anthropic authentication failed.";
  }

  return {
    id: runtimeId,
    displayName: definition.displayName,
    stability: definition.stability,
    authModes: [...definition.authModes],
    capabilities: { ...definition.capabilities },
    registered: Boolean(runner),
    enabled: config.enabled,
    configured,
    authMode: config.authMode,
    health,
    healthDetail,
    lastVerifiedAt: config.lastVerifiedAt,
    configVersion: config.configVersion,
    models: config.models,
    defaultModel: config.defaultModel,
  };
}

export async function listRuntimeCatalog(): Promise<RuntimeCatalogItem[]> {
  let runtimes: RunnerRuntimeSummary[] = [];
  try {
    runtimes = await listRunnerRuntimes();
  } catch {
    // A disconnected Runner is represented on each catalog row.
  }
  return runtimeIds.map((runtimeId) =>
    catalogItem(
      runtimeId,
      runtimes.find(({ id }) => id === runtimeId) ?? null,
    ),
  );
}

export async function updateRuntime(input: {
  runtimeId: RuntimeId;
  enabled?: boolean;
  apiKey?: string;
  defaultModel?: string;
}) {
  saveRuntimeConfiguration(input);
  return (await listRuntimeCatalog()).find(
    ({ id }) => id === input.runtimeId,
  )!;
}

export async function testRuntime(
  runtimeId: RuntimeId,
  dependencies: {
    fetcher?: typeof fetch;
    testCodex?: typeof testCodexRuntime;
    now?: () => string;
  } = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const testCodex = dependencies.testCodex ?? testCodexRuntime;
  const config = getRuntimeConfig(runtimeId);
  const checkedAt = dependencies.now?.() ?? new Date().toISOString();
  try {
    if (runtimeId === "codex") {
      await testCodex();
      if (!repository.completeRuntimeVerification({
        runtimeId,
        expectedConfigVersion: config.configVersion,
        status: "connected",
        detail: "Codex is available through slab-runner.",
        checkedAt,
      })) throw new RuntimeConfigurationChangedError();
    } else {
      if (!config.credentialCiphertext) {
        throw new Error("Configure an Anthropic API key first.");
      }
      const response = await fetcher("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": decryptLocalSecret(config.credentialCiphertext),
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        redirect: "manual",
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Anthropic rejected the configured API key."
            : `Anthropic model discovery returned ${response.status}.`,
        );
      }
      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      const discovered = (payload.data ?? [])
        .map(({ id }) => (typeof id === "string" ? id : ""))
        .filter((id) => id.length > 0 && id.length <= 200)
        .slice(0, 100);
      const models = ["default", ...new Set(discovered)];
      if (!repository.completeRuntimeVerification({
        runtimeId,
        expectedConfigVersion: config.configVersion,
        models,
        defaultModel: models.includes(config.defaultModel)
          ? config.defaultModel
          : "default",
        status: "connected",
        detail: `${discovered.length} Anthropic models available.`,
        checkedAt,
      })) throw new RuntimeConfigurationChangedError();
    }
  } catch (error) {
    if (error instanceof RuntimeConfigurationChangedError) throw error;
    if (!repository.completeRuntimeVerification({
      runtimeId,
      expectedConfigVersion: config.configVersion,
      status: "failed",
      detail:
        error instanceof Error ? error.message : "Runtime verification failed.",
      checkedAt,
    })) throw new RuntimeConfigurationChangedError();
    throw error;
  }
  return (await listRuntimeCatalog()).find(({ id }) => id === runtimeId)!;
}
