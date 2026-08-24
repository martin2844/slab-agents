import "server-only";

import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import { repository, type RuntimeConfigRecord } from "@/lib/repository";

export const runtimeIds = ["codex", "claude"] as const;
export type RuntimeId = (typeof runtimeIds)[number];

export const runtimeBudgetCapabilities: Record<
  RuntimeId,
  { nativeTokenLimit: boolean; nativeCostLimit: boolean }
> = {
  codex: { nativeTokenLimit: false, nativeCostLimit: false },
  claude: { nativeTokenLimit: true, nativeCostLimit: true },
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
}) {
  const current = getRuntimeConfig(input.runtimeId);
  const apiKey = input.apiKey?.trim();
  if (input.runtimeId === "codex" && apiKey) {
    throw new Error("Codex authentication is owned by slab-runner.");
  }
  const credentialCiphertext = apiKey
    ? encryptLocalSecret(apiKey)
    : current.credentialCiphertext;
  const enabled = input.enabled ?? current.enabled;
  if (input.runtimeId === "claude" && enabled && !credentialCiphertext) {
    throw new Error("Configure an Anthropic API key before enabling Claude.");
  }
  const defaultModel = input.defaultModel?.trim() || current.defaultModel;
  if (
    input.runtimeId !== "codex" &&
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
    defaultModel,
    models: current.models,
    ...(apiKey
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
  if (runtimeId !== "claude") return null;
  const config = getRuntimeConfig("claude");
  if (!config.enabled || !config.credentialCiphertext) {
    throw new Error("Claude is disabled or missing an Anthropic API key.");
  }
  return {
    mode: "api_key" as const,
    credential: decryptLocalSecret(config.credentialCiphertext),
  };
}
