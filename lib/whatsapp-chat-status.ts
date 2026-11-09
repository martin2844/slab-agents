import type { WhatsAppConversationState } from "@/lib/whatsapp-automation";

export type WhatsAppChatStatus = {
  automationId: string;
  agentId: string;
  enabled: boolean;
  blockedReason: string | null;
  waitingApproval: boolean;
  chat: WhatsAppConversationState;
};

export function whatsappPauseTitle(reason: string | null) {
  return reason?.startsWith("You replied from WhatsApp.")
    ? "Auto replies paused — you replied manually"
    : "Auto replies paused";
}
