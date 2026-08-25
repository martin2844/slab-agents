import "server-only";

import { settingsStore } from "@/lib/repositories/settings-store";
import { readSecret } from "@/lib/server-config";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";

export const settingKeys = [
  "work_mcp_url",
  "work_api_key",
  "docs_mcp_url",
  "docs_api_key",
  "runner_url",
  "operator_display_name",
  "coordination_reviewer",
] as const;
export type SettingKey = (typeof settingKeys)[number];

const defaults: Record<SettingKey, string> = {
  work_mcp_url: process.env.WORK_MCP_URL ?? "http://127.0.0.1:6969/mcp",
  work_api_key: readSecret("TRACKER_API_KEY", "TRACKER_API_KEY_FILE"),
  docs_mcp_url: process.env.DOCS_MCP_URL ?? "http://127.0.0.1:6980/mcp",
  docs_api_key: readSecret("DOCS_API_KEY", "DOCS_API_KEY_FILE"),
  runner_url: process.env.RUNNER_URL ?? "http://127.0.0.1:6990",
  operator_display_name: process.env.SLAB_OPERATOR_NAME ?? "Operator",
  coordination_reviewer: process.env.SLAB_COORDINATION_REVIEWER ?? "coo",
};

const secretSettingKeys = new Set<SettingKey>(["work_api_key", "docs_api_key"]);

const SETTING_SECRET_PREFIX = "encrypted:";

function decryptLegacyEnvelope(value: string) {
  if (!value.startsWith("v1.")) return null;
  try {
    return decryptLocalSecret(value);
  } catch {
    // Legacy API keys were arbitrary plaintext. A key beginning with `v1.` is
    // plaintext unless it authenticates successfully as our AES-GCM envelope.
    return null;
  }
}

function readStoredSecret(key: SettingKey, stored: string): string {
  if (stored.startsWith(SETTING_SECRET_PREFIX)) {
    return decryptLocalSecret(stored.slice(SETTING_SECRET_PREFIX.length));
  }

  const legacyDecrypted = decryptLegacyEnvelope(stored);
  if (legacyDecrypted !== null) {
    const tagged = `${SETTING_SECRET_PREFIX}${stored}`;
    if (settingsStore.compareAndSet(key, stored, tagged)) return legacyDecrypted;
    const current = settingsStore.get(key);
    if (current == null) return defaults[key];
    return readStoredSecret(key, current);
  }

  const encrypted = `${SETTING_SECRET_PREFIX}${encryptLocalSecret(stored)}`;
  if (settingsStore.compareAndSet(key, stored, encrypted)) return stored;

  // A concurrent settings write won the migration race. Read that value rather
  // than overwriting it with the stale plaintext value we observed.
  const current = settingsStore.get(key);
  if (current == null) return defaults[key];
  return readStoredSecret(key, current);
}

export function getSetting(key: SettingKey) {
  const stored = settingsStore.get(key);
  if (stored == null) return defaults[key];
  if (!secretSettingKeys.has(key)) return stored;
  return readStoredSecret(key, stored);
}

export function setSetting(key: SettingKey, value: string) {
  settingsStore.set(
    key,
    secretSettingKeys.has(key)
      ? `${SETTING_SECRET_PREFIX}${encryptLocalSecret(value)}`
      : value,
  );
}

export function getPublicSettings() {
  return {
    workMcpUrl: getSetting("work_mcp_url"),
    workApiKeyConfigured: Boolean(getSetting("work_api_key")),
    docsMcpUrl: getSetting("docs_mcp_url"),
    docsApiKeyConfigured: Boolean(getSetting("docs_api_key")),
    runnerUrl: getSetting("runner_url"),
    operatorDisplayName: getSetting("operator_display_name"),
    coordinationReviewer: getSetting("coordination_reviewer"),
  };
}

export function isAllowedRunnerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) return false;

  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  for (const hostname of (process.env.RUNNER_ALLOWED_HOSTS ?? "").split(",")) {
    if (hostname.trim()) allowedHosts.add(hostname.trim());
  }
  try {
    if (process.env.RUNNER_URL) {
      allowedHosts.add(new URL(process.env.RUNNER_URL).hostname);
    }
  } catch {
    // The route schema reports malformed URLs separately.
  }
  return allowedHosts.has(url.hostname);
}
