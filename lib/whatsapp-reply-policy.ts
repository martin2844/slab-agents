import "server-only";
import { conflict } from "@/lib/api";
import { whatsappUsesReplyReview } from "@/lib/whatsapp-automation";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";

const reviewEvent = "whatsapp.reply_review_requested";
export function markWhatsAppReplyForReview(runId: string) {
  if (!runRepository.hasRunEvent(runId, reviewEvent))
    runRepository.addRunEvent(runId, reviewEvent);
}

export function whatsappApprovalServer(
  runId: string,
  slug: string,
  review: boolean,
) {
  const config = whatsappRunReplyConfig(runId);
  const regularServer = `whatsapp_${slug}`;
  const reviewServer = `whatsapp_review_${slug}`;
  // Once review has been requested, changing tools or text cannot bypass it.
  if (
    review ||
    (whatsappUsesReplyReview(config) &&
      (runRepository.hasRunEvent(runId, reviewEvent) ||
        approvalRepository
          .listForRun(runId)
          .some(
            (item) =>
              item.details.server === reviewServer &&
              item.details.tool === "whatsapp_send_text",
          )))
  )
    return reviewServer;
  const policy =
    agentToolPolicyRepository.getRunSnapshot(runId)?.policies[regularServer];
  if (
    config?.replyApproval === "approval_required" ||
    (policy?.tools.whatsapp_send_text ?? policy?.defaultMode) === "prompt"
  )
    return regularServer;
  return null;
}

export function whatsappRunReplyConfig(runId: string) {
  const run = runRepository.getRun(runId);
  if (run?.trigger !== "whatsapp" || !run.automationId) return null;
  return automationRepository.getAutomation(run.automationId)?.whatsapp ?? null;
}

export function assertWhatsAppSendApproved(
  runId: string,
  server: string,
  args: { account: string; chatId: string; text: string },
) {
  const approved = approvalRepository.listForRun(runId).some((approval) => {
    const details = approval.details;
    const action = details.whatsappAction as
      Record<string, unknown> | undefined;
    return (
      (approval.status === "approved" ||
        (approval.status === "resolving" &&
          details.runnerDecision === "approve")) &&
      details.server === server &&
      details.tool === "whatsapp_send_text" &&
      details.writeContextRedacted !== true &&
      action?.account === args.account &&
      action.recipient === args.chatId &&
      action.text === args.text
    );
  });
  if (!approved)
    throw conflict(
      "This reply needs your approval before it can be sent.",
      "WHATSAPP_APPROVAL_REQUIRED",
    );
}
