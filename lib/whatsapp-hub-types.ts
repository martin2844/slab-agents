import type { RunRetryState, RunStatus } from "@/lib/types";
import type { WhatsAppConversationState } from "@/lib/whatsapp-automation";

/** Why a chat needs the owner, most urgent first. */
export type WhatsAppHubAttention =
  | "approval"
  | "failed"
  | "uncertain"
  | "paused"
  | "pending";

export const WHATSAPP_HUB_ATTENTION_RANK: Record<WhatsAppHubAttention, number> =
  { approval: 0, failed: 1, uncertain: 2, paused: 3, pending: 4 };

export type WhatsAppHubConversation = {
  account: string;
  chatId: string;
  contactName: string | null;
  /** Phone number, resolved from privacy IDs (@lid) when WhatsApp knows it. */
  phone: string | null;
  automationId: string;
  automationName: string;
  automationEnabled: boolean;
  agentId: string;
  agentName: string;
  threadId: string | null;
  paused: boolean;
  pauseReason: string | null;
  pendingMessages: number;
  activeRunId: string | null;
  activeRunStatus: RunStatus | null;
  lastRunId: string | null;
  lastReplyOutcome: WhatsAppConversationState["lastReplyOutcome"];
  /** Drafted reply waiting for the owner's approval, if any. */
  approval: {
    id: string;
    runId: string;
    text: string;
    createdAt: string;
    /** When the draft is sent automatically if the owner does not act. */
    fallbackAt: string | null;
  } | null;
  failedRun: { runId: string; retry: RunRetryState } | null;
  lastMessage: { body: string; fromMe: boolean; at: string } | null;
  attention: WhatsAppHubAttention | null;
  updatedAt: string;
};

export type WhatsAppHubData = {
  enabled: boolean;
  connected: boolean;
  account: string | null;
  conversations: WhatsAppHubConversation[];
  attentionCount: number;
};

export type WhatsAppHubMessage = {
  id: string;
  fromMe: boolean;
  body: string;
  timestamp: number;
  hasMedia: boolean;
};

/** The owner deliberately took the chat over (phone, Slab or manual pause). */
export function ownerTookOver(reason: string | null) {
  return (
    !!reason &&
    (reason.startsWith("You replied from WhatsApp.") ||
      reason.startsWith("You replied from Slab.") ||
      reason === "Paused by you.")
  );
}
