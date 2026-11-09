import "server-only";
import { resolveApprovalAction } from "@/lib/approval-resolution";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";

export const WHATSAPP_REVIEW_FALLBACK_EVENT = "whatsapp.review_fallback_sent";

type Dependencies = {
  approve?: (approvalId: string) => Promise<unknown>;
};

/**
 * Review-exception replies the owner has not acted on within the automation's
 * fallback window are sent as drafted, so no customer waits indefinitely. Only
 * a still-current turn qualifies: a newer customer message or an owner reply
 * supersedes the turn and its draft is never sent.
 */
export async function sendOverdueWhatsAppReviews(
  now = new Date(),
  dependencies: Dependencies = {},
) {
  const approve =
    dependencies.approve ??
    ((approvalId: string) => resolveApprovalAction(approvalId, "approve"));
  const sent: string[] = [];
  for (const approval of approvalRepository.list("pending")) {
    const details = approval.details;
    if (
      details.tool !== "whatsapp_send_text" ||
      typeof details.server !== "string" ||
      !details.server.startsWith("whatsapp_review_")
    )
      continue;
    const run = runRepository.getRun(approval.runId);
    if (
      run?.trigger !== "whatsapp" ||
      run.status !== "waiting_approval" ||
      !run.automationId
    )
      continue;
    const config = automationRepository.getAutomation(run.automationId)?.whatsapp;
    if (
      config?.replyApproval !== "review_exceptions" ||
      !config.reviewFallbackHours
    )
      continue;
    const dueAt =
      Date.parse(approval.createdAt) + config.reviewFallbackHours * 3_600_000;
    if (!Number.isFinite(dueAt) || now.getTime() < dueAt) continue;
    try {
      whatsappAutomationRepository.assertRun(run.id);
    } catch {
      continue; // Superseded turns are cancelled by reconciliation instead.
    }
    try {
      await approve(approval.id);
      runRepository.addRunEvent(run.id, WHATSAPP_REVIEW_FALLBACK_EVENT, {
        approvalId: approval.id,
        fallbackHours: config.reviewFallbackHours,
      });
      sent.push(approval.id);
    } catch (error) {
      console.error(
        "[whatsapp] Could not send an overdue review reply:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return sent;
}
