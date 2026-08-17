import "server-only";

import { repository } from "@/lib/repository";

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
  work_api_key: process.env.TRACKER_API_KEY ?? "",
  docs_mcp_url: process.env.DOCS_MCP_URL ?? "http://127.0.0.1:6980/mcp",
  docs_api_key: process.env.DOCS_API_KEY ?? "",
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
