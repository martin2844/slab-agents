import "server-only";

import { repository } from "@/lib/repository";
import { readSecret } from "@/lib/server-config";

export const settingKeys = [
  "work_mcp_url",
  "work_api_key",
  "docs_mcp_url",
  "docs_api_key",
  "runner_url",
] as const;
export type SettingKey = (typeof settingKeys)[number];

const defaults: Record<SettingKey, string> = {
  work_mcp_url: process.env.WORK_MCP_URL ?? "http://127.0.0.1:6969/mcp",
  work_api_key: readSecret("TRACKER_API_KEY", "TRACKER_API_KEY_FILE"),
  docs_mcp_url: process.env.DOCS_MCP_URL ?? "http://127.0.0.1:6980/mcp",
  docs_api_key: readSecret("DOCS_API_KEY", "DOCS_API_KEY_FILE"),
  runner_url: process.env.RUNNER_URL ?? "http://127.0.0.1:6990",
};

export function getSetting(key: SettingKey) {
  return repository.getSetting(key) ?? defaults[key];
}

export function getPublicSettings() {
  return {
    workMcpUrl: getSetting("work_mcp_url"),
    workApiKeyConfigured: Boolean(getSetting("work_api_key")),
    docsMcpUrl: getSetting("docs_mcp_url"),
    docsApiKeyConfigured: Boolean(getSetting("docs_api_key")),
    runnerUrl: getSetting("runner_url"),
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
