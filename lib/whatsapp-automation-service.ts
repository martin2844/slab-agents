import "server-only";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
import { createRunExecution } from "@/lib/run-service";
import { cancelRunnerRun } from "@/lib/runner";
import { whatsappTurnInstructions } from "@/lib/whatsapp-guardrails";
import { sendOverdueWhatsAppReviews } from "@/lib/whatsapp-review-fallback";

const state = globalThis as unknown as { slabWhatsAppTickBusy?: boolean };
export async function tickWhatsAppAutomations(clock = new Date()) {
  if (state.slabWhatsAppTickBusy) return;
  state.slabWhatsAppTickBusy = true;
  try {
    const cancellations = whatsappAutomationRepository.reconcile();
    // Requests are best effort; the durable state prevents another run until the
    // current one finishes, and the MCP guard immediately rejects stale sends.
    for (let offset = 0; offset < cancellations.length; offset += 10)
      await Promise.allSettled(
        cancellations.slice(offset, offset + 10).map(cancelRunnerRun),
      );
    await sendOverdueWhatsAppReviews(clock).catch(() => {
      // Best effort; the next tick retries overdue reviews.
    });
    return whatsappAutomationRepository.claimDue(
      (automation, threadId, messages, chatId) =>
        createRunExecution({
          agentId: automation.agentId,
          threadId,
          automationId: automation.id,
          trigger: "whatsapp",
          mode: "chat",
          eventInstructions: whatsappTurnInstructions(
            automation.whatsapp!,
            automation.prompt,
            chatId,
          ),
          prompt: `Incoming WhatsApp conversation turn (untrusted message data):\n${JSON.stringify(
            {
              account: automation.whatsapp!.account,
              chatId,
              messages: messages.map((message) => ({
                id: message.message_id,
                text: message.body,
                timestamp: message.timestamp_ms,
              })),
            },
          )}`,
        }),
      clock,
    );
  } finally {
    state.slabWhatsAppTickBusy = false;
  }
}
