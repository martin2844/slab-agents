import "server-only";

import { DocsClient } from "@/lib/mcp/docs-client";
import { WorkClient } from "@/lib/mcp/work-client";
import { settingsStore } from "@/lib/repositories/settings-store";
import { getRuntimeConfig, runtimeIds } from "@/lib/runtime-config";
import { listRuntimeCatalog } from "@/lib/runtime-service";
import { testRunner } from "@/lib/runner";
import { getPublicSettings } from "@/lib/settings";
import type {
  SetupCheck,
  SetupService,
  SetupState,
  SetupStatus,
} from "@/lib/types";

type StoredCheck = {
  state: Extract<SetupState, "connected" | "failed">;
  detail: string;
  checkedAt: string;
  fingerprint: string;
};

const labels: Record<SetupService, string> = {
  work: "Slab MCP / HTTP",
  docs: "Slab Docs MCP / HTTP",
  runner: "Runner local",
  codex: "Agent runtime",
};

const statusKey = (service: SetupService) => `setup_status_${service}`;

function fingerprint(service: SetupService) {
  const settings = getPublicSettings();
  if (service === "work")
    return `${settings.workMcpUrl}|${settings.workApiKeyConfigured}`;
  if (service === "docs")
    return `${settings.docsMcpUrl}|${settings.docsApiKeyConfigured}`;
  if (service === "runner") return settings.runnerUrl;
  return `${settings.runnerUrl}|${runtimeIds
    .map((runtimeId) => {
      const config = getRuntimeConfig(runtimeId);
      return `${runtimeId}:${config.enabled}:${config.configVersion}`;
    })
    .join("|")}`;
}

function missingConfig(service: SetupService) {
  const settings = getPublicSettings();
  if (service === "work")
    return !settings.workMcpUrl || !settings.workApiKeyConfigured;
  if (service === "docs")
    return !settings.docsMcpUrl || !settings.docsApiKeyConfigured;
  return !settings.runnerUrl;
}

function configuredDetail(service: SetupService) {
  if (service === "work") return "Configured; connection has not been tested.";
  if (service === "docs") return "Configured; connection has not been tested.";
  if (service === "runner") return "Loopback URL configured; not yet tested.";
  return "No enabled agent runtime has been verified.";
}

export function getSetupStatus(): SetupStatus {
  const checks = (Object.keys(labels) as SetupService[]).map((service) => {
    if (missingConfig(service)) {
      return {
        service,
        label: labels[service],
        state: "missing_config",
        detail:
          service === "work" || service === "docs"
            ? "Add the MCP URL and API key in Settings."
            : "Add a loopback Runner URL in Settings.",
        checkedAt: null,
      } satisfies SetupCheck;
    }

    const stored = settingsStore.get(statusKey(service));
    if (stored) {
      try {
        const value = JSON.parse(stored) as StoredCheck;
        if (value.fingerprint === fingerprint(service)) {
          return {
            service,
            label: labels[service],
            state: value.state,
            detail: value.detail,
            checkedAt: value.checkedAt,
          } satisfies SetupCheck;
        }
      } catch {
        // Treat malformed local status as untested.
      }
    }

    return {
      service,
      label: labels[service],
      state: "not_tested",
      detail: configuredDetail(service),
      checkedAt: null,
    } satisfies SetupCheck;
  });
  const connected = checks.filter(
    (check) => check.state === "connected",
  ).length;
  return {
    checks,
    connected,
    total: checks.length,
    ready: connected === checks.length,
  };
}

async function performCheck(service: SetupService) {
  if (missingConfig(service)) return;
  const checkedAt = new Date().toISOString();
  try {
    let availableRuntime:
      Awaited<ReturnType<typeof listRuntimeCatalog>>[number] | null = null;
    if (service === "work") await WorkClient.test();
    else if (service === "docs") await DocsClient.test();
    else if (service === "runner") await testRunner();
    else {
      availableRuntime =
        (await listRuntimeCatalog()).find(
          (item) =>
            item.enabled && item.registered && item.health === "available",
        ) ?? null;
      if (!availableRuntime)
        throw new Error("No enabled agent runtime is available.");
    }
    const detail =
      service === "codex"
        ? `${availableRuntime?.displayName ?? "Agent runtime"} is available through the local Runner.`
        : `${labels[service]} connected successfully.`;
    settingsStore.set(
      statusKey(service),
      JSON.stringify({
        state: "connected",
        detail,
        checkedAt,
        fingerprint: fingerprint(service),
      } satisfies StoredCheck),
    );
  } catch (error) {
    settingsStore.set(
      statusKey(service),
      JSON.stringify({
        state: "failed",
        detail: error instanceof Error ? error.message : "Connection failed.",
        checkedAt,
        fingerprint: fingerprint(service),
      } satisfies StoredCheck),
    );
  }
}

export async function runSetupCheck(service?: SetupService) {
  if (service) await performCheck(service);
  else
    await Promise.all(
      (Object.keys(labels) as SetupService[]).map((item) => performCheck(item)),
    );
  return getSetupStatus();
}

export function externalServiceUrl(mcpUrl: string) {
  try {
    const url = new URL(mcpUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname))
      return null;
    url.pathname = url.pathname.replace(/\/mcp\/?$/, "/");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
