import "server-only";

import { emailAutomationBlockReason } from "@/lib/email-automation-policy";
import {
  assertAgentEmailConnectorReady,
  getInboundEmailAccount,
} from "@/lib/integrations/email-service";
import { OperationalError } from "@/lib/operational-error";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";
import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";
import type { AutomationWorkflowStep } from "@/lib/automation-workflow";

export async function assertEmailAutomationTarget(
  agentId: string,
  accountId: string,
  steps: AutomationWorkflowStep[] = [],
) {
  if (steps[0] && steps[0].agentId !== agentId) {
    throw new OperationalError(
      "The first workflow step must use the automation agent.",
      "EMAIL_AUTOMATION_BLOCKED",
      409,
    );
  }
  const targets = new Set([agentId, ...steps.map((step) => step.agentId)]);
  for (const targetAgentId of targets) {
    const blocked = emailAutomationBlockReason(targetAgentId, accountId);
    if (blocked)
      throw new OperationalError(blocked, "EMAIL_AUTOMATION_BLOCKED", 409);
    assertAgentEmailConnectorReady(targetAgentId);
  }
  const account = await getInboundEmailAccount(accountId);
  const replyStep = steps.find((step) => step.action === "review_and_reply");
  if (replyStep) {
    const access = emailAccessRepository.getAgentEmailAccess(replyStep.agentId);
    if (
      !access?.sendEnabled ||
      access.sendPolicy === "disabled" ||
      !access.accountIds.includes(accountId)
    ) {
      throw new OperationalError(
        "The reply agent needs send access and an enabled send policy for this Email account.",
        "EMAIL_AUTOMATION_BLOCKED",
        409,
      );
    }
    const toolPolicy = agentToolPolicyRepository.get(replyStep.agentId, "email");
    const replyMode =
      toolPolicy?.tools.email_reply ?? toolPolicy?.defaultMode ?? "approve";
    if (replyMode === "deny") {
      throw new OperationalError(
        "The reply agent is not allowed to use email_reply.",
        "EMAIL_AUTOMATION_BLOCKED",
        409,
      );
    }
    if (!account.capabilities.reply) {
      throw new OperationalError(
        "The selected Email account does not support threaded replies.",
        "EMAIL_AUTOMATION_BLOCKED",
        409,
      );
    }
  }
  return account;
}
