import type { RunRetryState } from "@/lib/types";
import type { WhatsAppConversationState } from "@/lib/whatsapp-automation";

/** Persisted chat state for a WhatsApp-backed thread. */
export type WhatsAppChatStatusData = {
  automationId: string;
  agentId: string;
  enabled: boolean;
  blockedReason: string | null;
  waitingApproval: boolean;
  chat: WhatsAppConversationState;
};

/** API payload: chat state plus the retry state of its last failed turn. */
export type WhatsAppChatStatus = WhatsAppChatStatusData & {
  failedRun: { runId: string; retry: RunRetryState } | null;
};

export function whatsappPauseTitle(reason: string | null) {
  return reason?.startsWith("You replied from WhatsApp.") ||
    reason?.startsWith("You replied from Slab.")
    ? "Auto replies paused — you replied manually"
    : "Auto replies paused";
}
