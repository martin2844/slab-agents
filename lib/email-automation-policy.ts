import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";

export function emailAutomationBlockReason(
  agentId: string,
  accountId: string,
): string | null {
  const agent = agentRepository.getAgent(agentId);
  if (!agent) return "The assigned agent no longer exists.";
  if (!agent.enabled) return "The assigned agent is disabled.";
  const access = emailAccessRepository.getAgentEmailAccess(agentId);
  if (!access?.readEnabled || !access.accountIds.includes(accountId)) {
    return "The assigned agent no longer has read access to this Email account.";
  }
  const policy = agentToolPolicyRepository.get(agentId, "email");
  const readMode =
    policy?.tools.email_get_message ?? policy?.defaultMode ?? "approve";
  if (readMode === "deny") {
    return "The assigned agent is not allowed to read Email messages.";
  }
  return null;
}
