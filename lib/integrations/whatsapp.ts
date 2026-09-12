import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DomainError, conflict, notFound } from "@/lib/api";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { encryptLocalSecret } from "@/lib/secrets";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { WHATSAPP_TOOLS } from "@/lib/integrations/catalog";
import type { WhatsAppWriteMode } from "@/lib/types";

export const whatsappSession = "default";
const sessionSchema = z.object({
  status: z.string().max(80),
  me: z
    .object({
      id: z.string().max(150),
      pushName: z.string().max(200).nullish(),
    })
    .nullish(),
});

export async function wahaRequest(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  let key: string;
  try {
    key = (
      await readFile(
        process.env.SLAB_WAHA_API_KEY_FILE ?? "/run/secrets/waha_api_key",
        "utf8",
      )
    ).trim();
    if (!key) throw new Error();
  } catch {
    throw new DomainError(
      "WAHA_UNAVAILABLE",
      "Install WhatsApp on this host to start linking your account.",
      503,
    );
  }
  try {
    const response = await fetch(
      new URL(path, process.env.SLAB_WAHA_URL ?? "http://slab-whatsapp:3000"),
      {
        method,
        headers: {
          "X-Api-Key": key,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new DomainError(
        "WAHA_REQUEST_FAILED",
        `WhatsApp service returned HTTP ${response.status}.`,
        response.status === 404 ? 404 : 502,
      );
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "WAHA_UNAVAILABLE",
      method === "GET"
        ? "WhatsApp service is unavailable. Check installation or reconnect."
        : "WhatsApp did not confirm the operation. Check its state before retrying.",
      503,
    );
  }
}

export async function getWhatsAppSession() {
  try {
    return sessionSchema.parse(
      await wahaRequest(`/api/sessions/${whatsappSession}`),
    );
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) return null;
    throw error;
  }
}

// A changed account never inherits grants or in-flight capabilities from the old one.
export function syncWhatsAppAccount(
  session: z.infer<typeof sessionSchema> | null,
) {
  return withImmediateTransaction(() => {
    const current =
      integrationRepository.getIntegrationRecordByProvider("whatsapp");
    if (current?.config.providerMetadata?.unlinked === true)
      return integrationRepository.getIntegration(current.id);
    const account = session?.status === "WORKING" ? session.me?.id : null;
    if (!current && !account) return null;
    if (!account) return current ? integrationRepository.updateIntegrationCheckIfVersion(current.id, current.version, { status: current.enabled ? "failed" : "disabled", lastError: "WhatsApp is disconnected.", lastTestedAt: new Date().toISOString() }) : null;
    if (current?.config.accountEmail === account) return integrationRepository.updateIntegrationCheckIfVersion(current.id, current.version, { status: current.enabled ? "connected" : "disabled", lastError: null, lastTestedAt: new Date().toISOString() });
    return integrationRepository.saveIntegration({
      ...(current
        ? {
            id: current.id,
            expectedVersion: current.version,
            version: current.version + 1,
          }
        : {}),
      provider: "whatsapp",
      name: "WhatsApp",
      enabled: true,
      status: "connected",
      config: {
        accountEmail: account,
        accountName: session?.me?.pushName ?? null,
        providerMetadata: { writeModes: {} },
      },
      credentialsCiphertext: encryptLocalSecret(
        JSON.stringify({ mcpToken: randomUUID() }),
      ),
      permissions: {},
      lastError: null,
      lastTestedAt: new Date().toISOString(),
    });
  });
}

export async function getWhatsAppState() {
  const before = integrationRepository.getIntegrationRecordByProvider("whatsapp");
  const session = await getWhatsAppSession();
  const after = integrationRepository.getIntegrationRecordByProvider("whatsapp");
  const integration = before?.version === after?.version && before?.id === after?.id
    ? syncWhatsAppAccount(session) : after ? integrationRepository.getIntegration(after.id) : null;
  if (after?.config.providerMetadata?.unlinked === true) return { status: "STOPPED", account: null, qr: null, integration };
  let qr: string | null = null;
  if (session?.status === "SCAN_QR_CODE") {
    const image = z
      .object({
        mimetype: z.literal("image/png"),
        data: z
          .string()
          .max(200_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .parse(await wahaRequest(`/api/${whatsappSession}/auth/qr`));
    qr = `data:image/png;base64,${image.data}`;
  }
  return {
    status: session?.status ?? "NOT_LINKED",
    account: session?.me?.id ?? null,
    qr,
    integration,
  };
}

async function performSessionChange(
  action: "connect" | "restart" | "unlink",
) {
  if (action === "unlink") {
    // Revoke first: an upstream failure must not leave agents able to send.
    withImmediateTransaction(() => {
      const record =
        integrationRepository.getIntegrationRecordByProvider("whatsapp");
      if (record)
        integrationRepository.saveIntegration({
          ...record,
          enabled: false,
          status: "disabled",
          permissions: {},
          config: {
            ...record.config,
            accountEmail: null,
            providerMetadata: { writeModes: {}, unlinked: true },
          },
          expectedVersion: record.version,
          version: record.version + 1,
        });
    });
    const session = await getWhatsAppSession();
    if (session)
      await wahaRequest(`/api/sessions/${whatsappSession}/logout`, "POST");
    return;
  }
  const session = await getWhatsAppSession();
  if (!session) {
    await wahaRequest("/api/sessions", "POST", {
      name: whatsappSession,
      start: true,
      config: { noweb: { store: { enabled: true, fullSync: false } } },
    });
  } else if (
    action === "restart" ||
    ["STOPPED", "FAILED"].includes(session.status)
  ) {
    await wahaRequest(
      `/api/sessions/${whatsappSession}/${action === "restart" ? "restart" : "start"}`,
      "POST",
    );
  }
  withImmediateTransaction(() => {
    const record =
      integrationRepository.getIntegrationRecordByProvider("whatsapp");
    if (record?.config.providerMetadata?.unlinked === true)
      integrationRepository.saveIntegration({
        ...record,
        enabled: true,
        status: "not_tested",
        permissions: {},
        config: { ...record.config, providerMetadata: { writeModes: {} } },
        expectedVersion: record.version,
        version: record.version + 1,
      });
  });
}

export function setWhatsAppAccess(input: {
  agentId: string;
  read: boolean;
  write: WhatsAppWriteMode;
  expectedVersion: number;
}) {
  return withImmediateTransaction(() => {
    const record =
      integrationRepository.getIntegrationRecordByProvider("whatsapp");
    if (!record || !agentRepository.getAgent(input.agentId))
      throw notFound("WhatsApp connection or agent not found.");
    if (!record.enabled || record.status !== "connected")
      throw conflict("Link WhatsApp before assigning access.");
    const permissions = integrationRepository.listIntegrationPermissions(
      record.id,
    );
    permissions[input.agentId] = WHATSAPP_TOOLS.filter((tool) =>
      tool.readOnly ? input.read : input.write !== "disabled",
    ).map((tool) => tool.key);
    const modes =
      (record.config.providerMetadata?.writeModes as Record<
        string,
        WhatsAppWriteMode
      >) ?? {};
    return integrationRepository.saveIntegration({
      ...record,
      permissions,
      config: {
        ...record.config,
        providerMetadata: {
          ...record.config.providerMetadata,
          writeModes: { ...modes, [input.agentId]: input.write },
        },
      },
      expectedVersion: input.expectedVersion,
      version: record.version + 1,
    });
  });
}

export async function changeWhatsAppSession(action: "connect" | "restart" | "unlink") {
  const lockKey = "whatsapp_session_operation";
  const lease = JSON.stringify({ id: randomUUID(), expiresAt: Date.now() + 90_000 });
  withImmediateTransaction(() => {
    const previous = settingsRepository.get(lockKey);
    if (previous && JSON.parse(previous).expiresAt > Date.now()) throw conflict("Another WhatsApp connection action is running.");
    settingsRepository.set(lockKey, lease);
  });
  try { await performSessionChange(action); }
  finally { settingsRepository.compareAndSet(lockKey, lease, "{}"); }
}
