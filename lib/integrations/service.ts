import "server-only";

import { randomBytes } from "node:crypto";
import { POSTHOG_TOOLS } from "@/lib/integrations/catalog";
import {
  testPostHogConnection,
  type PostHogDatacenter,
} from "@/lib/integrations/posthog";
import { repository, type IntegrationRecord } from "@/lib/repository";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import type { Integration } from "@/lib/types";

type PostHogCredentials = { apiKey: string; mcpToken: string };

function readCredentials(record: IntegrationRecord): PostHogCredentials {
  try {
    const parsed = JSON.parse(
      decryptLocalSecret(record.credentialsCiphertext),
    ) as Partial<PostHogCredentials>;
    if (!parsed.apiKey || !parsed.mcpToken) throw new Error();
    return { apiKey: parsed.apiKey, mcpToken: parsed.mcpToken };
  } catch {
    throw new Error("Stored PostHog credentials could not be read.");
  }
}

function validPermissions(permissions: Record<string, string[]>) {
  const agentIds = new Set(repository.listAgents().map(({ id }) => id));
  const toolKeys = new Set(POSTHOG_TOOLS.map(({ key }) => key));
  return Object.fromEntries(
    Object.entries(permissions)
      .filter(([agentId]) => agentIds.has(agentId))
      .map(([agentId, tools]) => [
        agentId,
        [...new Set(tools)].filter((tool) => toolKeys.has(tool)),
      ])
      .filter(([, tools]) => tools.length > 0),
  );
}

export async function savePostHogIntegration(input: {
  id?: string;
  apiKey?: string;
  datacenter: PostHogDatacenter;
  permissions: Record<string, string[]>;
}): Promise<Integration> {
  const current = repository.getIntegrationRecord(input.id ?? "posthog");
  let previous: PostHogCredentials | null = null;
  if (current) {
    try {
      previous = readCredentials(current);
    } catch (error) {
      if (!input.apiKey?.trim()) throw error;
    }
  }
  const apiKey = input.apiKey?.trim() || previous?.apiKey;
  if (!apiKey) throw new Error("A PostHog personal API key is required.");
  const credentials: PostHogCredentials = {
    apiKey,
    mcpToken: previous?.mcpToken ?? randomBytes(32).toString("base64url"),
  };
  const testedAt = new Date().toISOString();
  let status: "connected" | "failed" = "connected";
  let lastError: string | null = null;
  try {
    await testPostHogConnection(input.datacenter, apiKey);
  } catch (error) {
    status = "failed";
    lastError =
      error instanceof Error ? error.message : "PostHog connection failed.";
  }
  return repository.saveIntegration({
    id: current?.id,
    provider: "posthog",
    name: "PostHog",
    datacenter: input.datacenter,
    credentialsCiphertext: encryptLocalSecret(JSON.stringify(credentials)),
    status,
    lastTestedAt: testedAt,
    lastError,
    permissions: validPermissions(input.permissions),
  });
}

export async function retestPostHogIntegration(id: string) {
  const record = repository.getIntegrationRecord(id);
  if (!record || record.provider !== "posthog") {
    throw new Error("PostHog integration not found.");
  }
  const testedAt = new Date().toISOString();
  try {
    await testPostHogConnection(
      record.config.datacenter,
      readCredentials(record).apiKey,
    );
    return repository.updateIntegrationCheck(id, {
      status: "connected",
      lastTestedAt: testedAt,
      lastError: null,
    })!;
  } catch (error) {
    return repository.updateIntegrationCheck(id, {
      status: "failed",
      lastTestedAt: testedAt,
      lastError:
        error instanceof Error ? error.message : "PostHog connection failed.",
    })!;
  }
}

export function getPostHogRuntimeAccess(
  integrationId: string,
  agentId: string,
) {
  const record = repository.getIntegrationRecord(integrationId);
  if (
    !record ||
    record.provider !== "posthog" ||
    record.status !== "connected"
  ) {
    return null;
  }
  const allowedTools =
    repository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;
  return {
    record,
    credentials: readCredentials(record),
    allowedTools,
  };
}

export function getAgentPostHogMcp(agentId: string) {
  const record = repository.getIntegrationRecord("posthog");
  if (!record || record.status !== "connected") return null;
  const allowedTools =
    repository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (allowedTools.length === 0) return null;
  const { mcpToken } = readCredentials(record);
  const port = process.env.PORT?.trim() || "3009";
  return {
    name: "posthog" as const,
    url: `http://127.0.0.1:${port}/api/integrations/${encodeURIComponent(record.id)}/mcp?agent=${encodeURIComponent(agentId)}`,
    credentials: { bearerToken: mcpToken },
  };
}
