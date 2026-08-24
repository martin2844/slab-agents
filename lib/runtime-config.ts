import "server-only";

import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import { repository, type RuntimeConfigRecord } from "@/lib/repository";

export const runtimeIds = ["codex", "claude", "direct_api", "gemini"] as const;
export type RuntimeId = (typeof runtimeIds)[number];

export const runtimeBudgetCapabilities: Record<
  RuntimeId,
  {
    nativeTokenLimit: boolean;
    nativeCostLimit: boolean;
    incrementalTokenUsage: boolean;
  }
> = {
  codex: {
    nativeTokenLimit: false,
    nativeCostLimit: false,
    incrementalTokenUsage: true,
  },
  claude: {
    nativeTokenLimit: false,
    nativeCostLimit: true,
    incrementalTokenUsage: false,
  },
  direct_api: {
    nativeTokenLimit: false,
    nativeCostLimit: false,
    incrementalTokenUsage: true,
  },
  gemini: {
    nativeTokenLimit: false,
    nativeCostLimit: false,
    incrementalTokenUsage: false,
  },
};

export const runtimeDefaults: Record<
  RuntimeId,
  Pick<
    RuntimeConfigRecord,
    "runtimeId" | "enabled" | "authMode" | "defaultModel" | "models"
  >
> = {
  codex: {
    runtimeId: "codex",
    enabled: true,
    authMode: "runtime_owned",
    defaultModel: "default",
    models: ["default", "gpt-5.4", "gpt-5.5"],
  },
  claude: {
    runtimeId: "claude",
    enabled: false,
    authMode: "api_key",
    defaultModel: "default",
    models: ["default"],
  },
  direct_api: {
    runtimeId: "direct_api",
    enabled: false,
    authMode: "api_key",
    defaultModel: "gpt-5.4",
    models: ["gpt-5.4"],
  },
  gemini: {
    runtimeId: "gemini",
    enabled: false,
    authMode: "runtime_owned",
    defaultModel: "default",
    models: ["default"],
  },
};

export function isRuntimeId(value: string): value is RuntimeId {
  return (runtimeIds as readonly string[]).includes(value);
}

export function getRuntimeConfig(runtimeId: RuntimeId): RuntimeConfigRecord {
  const stored = repository.getRuntimeConfig(runtimeId);
  if (stored) return stored;
  const defaults = runtimeDefaults[runtimeId];
  const timestamp = new Date().toISOString();
  return {
    ...defaults,
    credentialCiphertext: null,
    baseUrl: runtimeId === "direct_api" ? "https://api.openai.com/v1" : null,
    apiFormat: runtimeId === "direct_api" ? "responses" : null,
    configVersion: 0,
    lastVerificationStatus: null,
    lastVerificationDetail: null,
    lastVerifiedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function saveRuntimeConfiguration(input: {
  runtimeId: RuntimeId;
  enabled?: boolean;
  apiKey?: string;
  defaultModel?: string;
  baseUrl?: string;
  apiFormat?: "responses" | "chat_completions";
}) {
  const current = getRuntimeConfig(input.runtimeId);
  const apiKey = input.apiKey?.trim();
  if (current.authMode === "runtime_owned" && apiKey) {
    throw new Error(
      `${input.runtimeId} authentication is owned by slab-runner.`,
    );
  }
  const credentialCiphertext = apiKey
    ? encryptLocalSecret(apiKey)
    : current.credentialCiphertext;
  const enabled = input.enabled ?? current.enabled;
  if (input.runtimeId === "claude" && enabled && !credentialCiphertext) {
    throw new Error("Configure an Anthropic API key before enabling Claude.");
  }
  if (input.runtimeId === "direct_api" && enabled && !credentialCiphertext) {
    throw new Error("Configure an API key before enabling Direct API.");
  }
  const baseUrl =
    input.runtimeId === "direct_api"
      ? normalizeDirectApiUrl(input.baseUrl ?? current.baseUrl ?? "")
      : current.baseUrl;
  const apiFormat =
    input.runtimeId === "direct_api"
      ? (input.apiFormat ?? current.apiFormat ?? "responses")
      : current.apiFormat;
  const connectionChanged =
    Boolean(apiKey) ||
    (input.runtimeId === "direct_api" &&
      (baseUrl !== current.baseUrl || apiFormat !== current.apiFormat));
  const defaultModel = input.defaultModel?.trim() || current.defaultModel;
  if (
    input.runtimeId !== "codex" &&
    input.runtimeId !== "direct_api" &&
    !current.models.includes(defaultModel) &&
    defaultModel !== "default"
  ) {
    throw new Error("Choose a model reported by the configured runtime.");
  }
  return repository.saveRuntimeConfig({
    runtimeId: input.runtimeId,
    enabled,
    authMode: current.authMode,
    credentialCiphertext,
    baseUrl,
    apiFormat,
    defaultModel,
    models: current.models,
    ...(connectionChanged
      ? {
          lastVerificationStatus: null,
          lastVerificationDetail: null,
          lastVerifiedAt: null,
        }
      : {}),
  });
}

export function assertRuntimeSelectable(runtimeId: string, model: string) {
  if (!isRuntimeId(runtimeId)) throw new Error("Unsupported agent runtime.");
  const config = getRuntimeConfig(runtimeId);
  if (!config.enabled) throw new Error(`${runtimeId} runtime is disabled.`);
  // Codex app-server does not currently advertise or validate a model
  // catalog. Preserve existing explicit model values and let the runtime own
  // that validation until its adapter declares support for it.
  if (
    runtimeId !== "codex" &&
    model !== "default" &&
    !config.models.includes(model)
  ) {
    throw new Error("The selected model is not available for this runtime.");
  }
}

export function resolveRuntimeModel(runtimeId: string, model: string) {
  if (!isRuntimeId(runtimeId)) throw new Error("Unsupported agent runtime.");
  const selected =
    model === "default" ? getRuntimeConfig(runtimeId).defaultModel : model;
  assertRuntimeSelectable(runtimeId, selected);
  return selected;
}

export function getRuntimeAuthentication(runtimeId: string) {
  if (runtimeId !== "claude" && runtimeId !== "direct_api") return null;
  const config = getRuntimeConfig(runtimeId);
  if (!config.enabled || !config.credentialCiphertext) {
    throw new Error(`${runtimeId} is disabled or missing an API key.`);
  }
  return {
    mode: "api_key" as const,
    credential: decryptLocalSecret(config.credentialCiphertext),
    ...(runtimeId === "direct_api"
      ? {
          baseUrl: normalizeDirectApiUrl(config.baseUrl ?? ""),
          apiFormat: config.apiFormat ?? "responses",
        }
      : {}),
  };
}

function normalizeDirectApiUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Direct API URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Direct API credentials must not be embedded in the URL.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "Direct API URL cannot include a query string or fragment.",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}
