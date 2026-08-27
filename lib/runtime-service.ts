import "server-only";

import { runtimeConfigRepository } from "@/lib/repositories/runtime-config-repository";

import { OperationalError } from "@/lib/operational-error";

import { decryptLocalSecret } from "@/lib/secrets";
import {
  getRuntimeConfig,
  runtimeIds,
  saveRuntimeConfiguration,
  type RuntimeId,
} from "@/lib/runtime-config";
import {
  listRunnerRuntimes,
  testRunnerRuntime,
  type RunnerRuntimeSummary,
} from "@/lib/runner";
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
  direct_api: {
    id: "direct_api",
    displayName: "Direct API",
    stability: "experimental",
    authModes: ["api_key"],
    capabilities: {},
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    stability: "experimental",
    authModes: ["api_key"],
    capabilities: {},
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini CLI",
    stability: "experimental",
    authModes: ["oauth"],
    capabilities: {},
  },
};

class RuntimeConfigurationChangedError extends Error {
  constructor() {
    super(
      "Runtime configuration changed while the test was running. Test it again.",
    );
  }
}

async function readJsonLimited(
  response: Response,
  maxBytes = 1_048_576,
): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new OperationalError(
          "Runtime model discovery response is too large.",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");
  return JSON.parse(body);
}

function catalogItem(
  runtimeId: RuntimeId,
  runner: RunnerRuntimeSummary | null,
): RuntimeCatalogItem {
  const config = getRuntimeConfig(runtimeId);
  const fallback = fallbackDefinitions[runtimeId];
  const definition = runner ?? fallback;
  const authModes = Array.isArray(runner?.authModes)
    ? runner.authModes
    : fallback.authModes;
  const capabilities =
    runner?.capabilities && typeof runner.capabilities === "object"
      ? runner.capabilities
      : fallback.capabilities;
  const runtimeOwned = config.authMode === "runtime_owned";
  const configured = runtimeOwned || Boolean(config.credentialCiphertext);
  let health: RuntimeCatalogItem["health"] = "not_tested";
  let healthDetail = "Runtime has not been verified.";

  if (!runner) {
    health = "unavailable";
    healthDetail = "The connected Runner does not provide this runtime.";
  } else if (runtimeOwned) {
    health = runner.status;
    healthDetail = runner.available
      ? "Authenticated in slab-runner."
      : runner.status === "authentication_required"
        ? runtimeId === "codex"
          ? "Connect a ChatGPT account below."
          : "Authenticate Gemini CLI with sudo slabctl gemini login."
        : `${definition.displayName} is unavailable in slab-runner.`;
  } else if (runner.status === "unavailable") {
    health = "unavailable";
    healthDetail = `${definition.displayName} is unavailable in slab-runner.`;
  } else if (!configured) {
    health = "authentication_required";
    healthDetail = `Add an API key, then test ${definition.displayName}.`;
  } else if (config.lastVerificationStatus === "connected") {
    health = "available";
    healthDetail = config.lastVerificationDetail ?? "API key verified.";
  } else if (config.lastVerificationStatus === "failed") {
    health = "unavailable";
    healthDetail =
      config.lastVerificationDetail ?? `${definition.displayName} test failed.`;
  }

  return {
    id: runtimeId,
    displayName: definition.displayName,
    stability: definition.stability,
    authModes: [...authModes],
    capabilities: { ...capabilities },
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
    baseUrl: config.baseUrl,
    apiFormat: config.apiFormat,
    providerRouting:
      runtimeId === "openrouter"
        ? {
            requireParameters: config.openrouterRequireParameters,
            dataCollection: config.openrouterDataCollection,
            zdr: config.openrouterZdr,
          }
        : null,
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
    catalogItem(runtimeId, runtimes.find(({ id }) => id === runtimeId) ?? null),
  );
}

export async function updateRuntime(input: {
  runtimeId: RuntimeId;
  enabled?: boolean;
  apiKey?: string;
  defaultModel?: string;
  baseUrl?: string;
  apiFormat?: "responses" | "chat_completions";
  requireParameters?: boolean;
  dataCollection?: "allow" | "deny";
  zdr?: boolean;
}) {
  saveRuntimeConfiguration(input);
  return (await listRuntimeCatalog()).find(({ id }) => id === input.runtimeId)!;
}

export async function testRuntime(
  runtimeId: RuntimeId,
  dependencies: {
    fetcher?: typeof fetch;
    testRuntimeOwned?: typeof testRunnerRuntime;
    now?: () => string;
  } = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const testRuntimeOwned = dependencies.testRuntimeOwned ?? testRunnerRuntime;
  const config = getRuntimeConfig(runtimeId);
  const checkedAt = dependencies.now?.() ?? new Date().toISOString();
  try {
    if (runtimeId === "codex" || runtimeId === "gemini") {
      await testRuntimeOwned(runtimeId);
      if (
        !runtimeConfigRepository.completeRuntimeVerification({
          runtimeId,
          expectedConfigVersion: config.configVersion,
          status: "connected",
          detail: `${fallbackDefinitions[runtimeId].displayName} is available through slab-runner.`,
          checkedAt,
        })
      )
        throw new RuntimeConfigurationChangedError();
    } else if (runtimeId === "claude") {
      if (!config.credentialCiphertext) {
        throw new OperationalError("Configure an Anthropic API key first.");
      }
      const response = await fetcher(
        "https://api.anthropic.com/v1/models?limit=100",
        {
          headers: {
            "x-api-key": decryptLocalSecret(config.credentialCiphertext),
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
          redirect: "manual",
        },
      );
      if (response.status >= 300 && response.status < 400) {
        throw new OperationalError(
          "Anthropic model discovery refused a redirect.",
        );
      }
      if (!response.ok) {
        throw new OperationalError(
          response.status === 401 || response.status === 403
            ? "Anthropic rejected the configured API key."
            : `Anthropic model discovery returned ${response.status}.`,
        );
      }
      const payload = (await readJsonLimited(response)) as {
        data?: Array<{ id?: unknown }>;
      };
      const discovered = (Array.isArray(payload?.data) ? payload.data : [])
        .map(({ id }) => (typeof id === "string" ? id : ""))
        .filter((id) => id.length > 0 && id.length <= 200)
        .slice(0, 100);
      const models = ["default", ...new Set(discovered)];
      if (
        !runtimeConfigRepository.completeRuntimeVerification({
          runtimeId,
          expectedConfigVersion: config.configVersion,
          models,
          defaultModel: models.includes(config.defaultModel)
            ? config.defaultModel
            : "default",
          status: "connected",
          detail: `${discovered.length} Anthropic models available.`,
          checkedAt,
        })
      )
        throw new RuntimeConfigurationChangedError();
    } else if (runtimeId === "openrouter") {
      if (!config.credentialCiphertext) {
        throw new OperationalError("Configure an OpenRouter API key first.");
      }
      const credential = decryptLocalSecret(config.credentialCiphertext);
      const requestOptions = {
        headers: {
          Authorization: `Bearer ${credential}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store" as const,
        redirect: "manual" as const,
      };
      const keyResponse = await fetcher(
        "https://openrouter.ai/api/v1/key",
        requestOptions,
      );
      if (keyResponse.status >= 300 && keyResponse.status < 400) {
        throw new OperationalError("OpenRouter key check refused a redirect.");
      }
      if (!keyResponse.ok) {
        throw new OperationalError(
          keyResponse.status === 401 || keyResponse.status === 403
            ? "OpenRouter rejected the configured API key."
            : `OpenRouter key check returned ${keyResponse.status}.`,
        );
      }
      const keyPayload = (await readJsonLimited(keyResponse)) as {
        data?: unknown;
      };
      if (
        !keyPayload?.data ||
        typeof keyPayload.data !== "object" ||
        Array.isArray(keyPayload.data)
      ) {
        throw new OperationalError(
          "OpenRouter key check returned an invalid response.",
        );
      }

      const params = new URLSearchParams({ supported_parameters: "tools" });
      if (config.openrouterZdr) params.set("zdr", "true");
      const response = await fetcher(
        `https://openrouter.ai/api/v1/models?${params.toString()}`,
        requestOptions,
      );
      if (response.status >= 300 && response.status < 400) {
        throw new OperationalError(
          "OpenRouter model discovery refused a redirect.",
        );
      }
      if (!response.ok) {
        throw new OperationalError(
          response.status === 401 || response.status === 403
            ? "OpenRouter rejected the configured API key."
            : `OpenRouter model discovery returned ${response.status}.`,
        );
      }
      const payload = (await readJsonLimited(response)) as {
        data?: Array<{ id?: unknown; supported_parameters?: unknown }>;
      };
      const discovered = (Array.isArray(payload?.data) ? payload.data : [])
        .filter(
          ({ supported_parameters }) =>
            Array.isArray(supported_parameters) &&
            supported_parameters.includes("tools"),
        )
        .map(({ id }) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0 && id.length <= 200)
        .slice(0, 500);
      const models = [...new Set(discovered)];
      if (models.length === 0) {
        throw new OperationalError(
          "OpenRouter did not report any tool-capable models for this policy.",
        );
      }
      if (
        !runtimeConfigRepository.completeRuntimeVerification({
          runtimeId,
          expectedConfigVersion: config.configVersion,
          models,
          defaultModel: models.includes(config.defaultModel)
            ? config.defaultModel
            : models[0],
          status: "connected",
          detail: `${models.length} tool-capable OpenRouter models available${config.openrouterZdr ? " with zero-data-retention routing" : ""}.`,
          checkedAt,
        })
      )
        throw new RuntimeConfigurationChangedError();
    } else {
      if (!config.credentialCiphertext || !config.baseUrl) {
        throw new OperationalError(
          "Configure a Direct API endpoint and API key first.",
        );
      }
      const response = await fetcher(
        `${config.baseUrl.replace(/\/$/, "")}/models`,
        {
          headers: {
            Authorization: `Bearer ${decryptLocalSecret(config.credentialCiphertext)}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
          redirect: "manual",
        },
      );
      if (response.status >= 300 && response.status < 400) {
        throw new OperationalError(
          "Direct API model discovery refused a redirect.",
        );
      }
      if (!response.ok) {
        throw new OperationalError(
          response.status === 401 || response.status === 403
            ? "The provider rejected the configured API key."
            : `Direct API model discovery returned ${response.status}.`,
        );
      }
      const payload = (await readJsonLimited(response)) as {
        data?: Array<{ id?: unknown }>;
      };
      const discovered = (Array.isArray(payload?.data) ? payload.data : [])
        .map(({ id }) => (typeof id === "string" ? id : ""))
        .filter((id) => id.length > 0 && id.length <= 200)
        .slice(0, 200);
      if (discovered.length === 0) {
        throw new OperationalError(
          "Direct API did not report any usable models.",
        );
      }
      const models = [...new Set(discovered)];
      if (
        !runtimeConfigRepository.completeRuntimeVerification({
          runtimeId,
          expectedConfigVersion: config.configVersion,
          models,
          defaultModel: models.includes(config.defaultModel)
            ? config.defaultModel
            : models[0],
          status: "connected",
          detail: `${models.length} provider models available through ${config.apiFormat ?? "responses"}.`,
          checkedAt,
        })
      )
        throw new RuntimeConfigurationChangedError();
    }
  } catch (error) {
    if (error instanceof RuntimeConfigurationChangedError) throw error;
    if (
      !runtimeConfigRepository.completeRuntimeVerification({
        runtimeId,
        expectedConfigVersion: config.configVersion,
        status: "failed",
        detail:
          error instanceof Error
            ? error.message
            : "Runtime verification failed.",
        checkedAt,
      })
    )
      throw new RuntimeConfigurationChangedError();
    throw error;
  }
  return (await listRuntimeCatalog()).find(({ id }) => id === runtimeId)!;
}
