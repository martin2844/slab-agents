import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { conflict, notFound } from "@/lib/api";
import {
  getWhatsAppSession,
  wahaRequest,
  whatsappSession,
} from "@/lib/integrations/whatsapp";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
import { getRunRetryState } from "@/lib/run-retry";
import type { Automation } from "@/lib/types";
import { whatsappDirectChatSchema } from "@/lib/whatsapp-automation";
import {
  WHATSAPP_HUB_ATTENTION_RANK,
  type WhatsAppHubAttention,
  type WhatsAppHubConversation,
  type WhatsAppHubData,
  type WhatsAppHubMessage,
} from "@/lib/whatsapp-hub-types";

/** Linked account when the WhatsApp integration is enabled, else null. */
export function enabledWhatsAppAccount() {
  const integration =
    integrationRepository.getIntegrationRecordByProvider("whatsapp");
  return integration?.enabled && integration.config.accountEmail
    ? String(integration.config.accountEmail)
    : null;
}

// Contact names come from WhatsApp itself; cache them briefly so the hub can
// poll without hammering WAHA. Best effort: names are cosmetic.
const nameCache = globalThis as unknown as {
  slabWhatsAppNames?: { at: number; names: Map<string, string> };
};
async function contactNames() {
  const cached = nameCache.slabWhatsAppNames;
  if (cached && Date.now() - cached.at < 60_000) return cached.names;
  const names = new Map<string, string>();
  try {
    for (let offset = 0; offset < 200; offset += 50) {
      const rows = await wahaRequest(
        `/api/${whatsappSession}/chats?limit=50&offset=${offset}`,
      );
      if (!Array.isArray(rows)) break;
      for (const row of rows) {
        const parsed = z
          .object({ id: z.string(), name: z.string().max(300).nullish() })
          .safeParse(row);
        if (parsed.success && parsed.data.name)
          names.set(parsed.data.id, parsed.data.name);
      }
      if (rows.length < 50) break;
    }
  } catch {
    return cached?.names ?? names;
  }
  nameCache.slabWhatsAppNames = { at: Date.now(), names };
  return names;
}

function pendingApproval(runId: string, automation: Automation) {
  const approval = approvalRepository
    .listForRun(runId)
    .find(
      (item) =>
        item.status === "pending" &&
        item.details.tool === "whatsapp_send_text",
    );
  if (!approval) return null;
  const action = approval.details.whatsappAction as
    | Record<string, unknown>
    | undefined;
  const hours =
    automation.whatsapp?.replyApproval === "review_exceptions"
      ? automation.whatsapp.reviewFallbackHours
      : 0;
  return {
    id: approval.id,
    runId,
    text: typeof action?.text === "string" ? action.text : "",
    createdAt: approval.createdAt,
    fallbackAt: hours
      ? new Date(
          Date.parse(approval.createdAt) + hours * 3_600_000,
        ).toISOString()
      : null,
  };
}

function attentionFor(
  chat: Omit<WhatsAppHubConversation, "attention">,
): WhatsAppHubAttention | null {
  if (chat.approval) return "approval";
  if (chat.failedRun?.retry.status === "available") return "failed";
  if (chat.lastReplyOutcome === "uncertain") return "uncertain";
  if (chat.paused) return "paused";
  if (chat.pendingMessages > 0 && !chat.activeRunId) return "pending";
  return null;
}

function buildConversations(account: string, names: Map<string, string>) {
  const automations = automationRepository
    .listAutomations()
    .filter(
      (item) =>
        item.triggerType === "whatsapp" && item.whatsapp?.account === account,
    );
  const lastMessages = whatsappAutomationRepository.lastMessages(account);
  const byChat = new Map<string, WhatsAppHubConversation>();
  for (const automation of automations) {
    const agent = agentRepository.getAgent(automation.agentId);
    for (const chat of whatsappAutomationRepository.listConversations(
      automation.id,
    )) {
      const existing = byChat.get(chat.chatId);
      // Prefer the enabled automation when a disabled one lists the same chat.
      if (existing && (existing.automationEnabled || !automation.enabled))
        continue;
      const activeRun = chat.activeRunId
        ? runRepository.getRun(chat.activeRunId)
        : null;
      const lastRun = chat.lastRunId
        ? runRepository.getRun(chat.lastRunId)
        : null;
      const retry = lastRun
        ? getRunRetryState(lastRun, runRepository.listRunEvents(lastRun.id))
        : null;
      const base = {
        account,
        chatId: chat.chatId,
        contactName: names.get(chat.chatId) ?? null,
        automationId: automation.id,
        automationName: automation.name,
        automationEnabled: automation.enabled,
        agentId: automation.agentId,
        agentName: agent?.name ?? "Unknown agent",
        threadId: whatsappAutomationRepository.threadFor(
          account,
          chat.chatId,
          automation.agentId,
        ),
        paused: chat.paused,
        pauseReason: chat.pauseReason,
        pendingMessages: chat.pendingMessages,
        activeRunId: chat.activeRunId,
        activeRunStatus: activeRun?.status ?? null,
        lastRunId: chat.lastRunId,
        lastReplyOutcome: chat.lastReplyOutcome,
        approval:
          activeRun?.status === "waiting_approval"
            ? pendingApproval(activeRun.id, automation)
            : null,
        failedRun: lastRun && retry ? { runId: lastRun.id, retry } : null,
        lastMessage: lastMessages.get(chat.chatId) ?? null,
        updatedAt: chat.updatedAt,
      };
      byChat.set(chat.chatId, { ...base, attention: attentionFor(base) });
    }
  }
  return [...byChat.values()].sort((a, b) => {
    const rank = (chat: WhatsAppHubConversation) =>
      chat.attention ? WHATSAPP_HUB_ATTENTION_RANK[chat.attention] : 9;
    return (
      rank(a) - rank(b) ||
      (b.lastMessage?.at ?? b.updatedAt).localeCompare(
        a.lastMessage?.at ?? a.updatedAt,
      )
    );
  });
}

export async function getWhatsAppHubData(): Promise<WhatsAppHubData> {
  const account = enabledWhatsAppAccount();
  if (!account)
    return {
      enabled: false,
      connected: false,
      account: null,
      conversations: [],
      attentionCount: 0,
    };
  const [session, names] = await Promise.all([
    getWhatsAppSession().catch(() => null),
    contactNames(),
  ]);
  const conversations = buildConversations(account, names);
  return {
    enabled: true,
    connected: session?.status === "WORKING" && session.me?.id === account,
    account,
    conversations,
    attentionCount: conversations.filter((chat) => chat.attention).length,
  };
}

/** Lightweight state for the navigation: visibility and attention badge. */
export function getWhatsAppNavState() {
  const account = enabledWhatsAppAccount();
  if (!account) return { enabled: false, attention: 0 };
  return {
    enabled: true,
    attention: buildConversations(account, new Map()).filter(
      (chat) => chat.attention,
    ).length,
  };
}

function assertHubChat(chatId: string) {
  const account = enabledWhatsAppAccount();
  if (!account) throw conflict("WhatsApp is not enabled.");
  whatsappDirectChatSchema.parse(chatId);
  if (!whatsappAutomationRepository.hasConversation(account, chatId))
    throw notFound("WhatsApp conversation not found.");
  return account;
}

const wahaMessageSchema = z.object({
  id: z.union([z.string(), z.object({ _serialized: z.string() })]),
  fromMe: z.boolean().optional().default(false),
  body: z.string().nullish(),
  timestamp: z.number(),
  hasMedia: z.boolean().optional().default(false),
});

export async function getWhatsAppHubMessages(
  chatId: string,
): Promise<{ messages: WhatsAppHubMessage[]; source: "whatsapp" | "stored" }> {
  const account = assertHubChat(chatId);
  try {
    const rows = await wahaRequest(
      `/api/${whatsappSession}/chats/${encodeURIComponent(chatId)}/messages?limit=60&downloadMedia=false`,
    );
    if (!Array.isArray(rows)) throw new Error("Unexpected history");
    const messages = rows
      .flatMap((row) => {
        const parsed = wahaMessageSchema.safeParse(row);
        if (!parsed.success) return [];
        const { id, fromMe, body, timestamp, hasMedia } = parsed.data;
        return [
          {
            id: typeof id === "string" ? id : id._serialized,
            fromMe,
            body: body ?? "",
            // WAHA reports seconds; normalize to milliseconds.
            timestamp: timestamp < 1e12 ? timestamp * 1000 : timestamp,
            hasMedia,
          },
        ];
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    return { messages, source: "whatsapp" };
  } catch {
    return {
      messages: whatsappAutomationRepository.storedMessages(account, chatId),
      source: "stored",
    };
  }
}

export async function sendManualWhatsAppReply(input: {
  chatId: string;
  text: string;
  keepAutoReplies: boolean;
}) {
  const account = assertHubChat(input.chatId);
  const session = await getWhatsAppSession().catch(() => null);
  if (session?.status !== "WORKING" || session.me?.id !== account)
    throw conflict(
      "WhatsApp is disconnected. Reconnect it in Integrations before replying.",
      "WHATSAPP_DISCONNECTED",
    );
  // Supersede the agent first so it cannot answer on top of this reply.
  whatsappAutomationRepository.beginOwnerReply(
    account,
    input.chatId,
    input.keepAutoReplies,
  );
  const sent = (await wahaRequest("/api/sendText", "POST", {
    session: whatsappSession,
    chatId: input.chatId,
    text: input.text,
    linkPreview: false,
  })) as { id?: unknown } | null;
  const rawId = sent?.id;
  const messageId =
    typeof rawId === "string"
      ? rawId
      : rawId &&
          typeof rawId === "object" &&
          typeof (rawId as { _serialized?: unknown })._serialized === "string"
        ? (rawId as { _serialized: string })._serialized
        : `slab-manual-${randomUUID()}`;
  whatsappAutomationRepository.recordOwnerReply({
    account,
    chatId: input.chatId,
    messageId,
    text: input.text,
  });
  return { messageId };
}
