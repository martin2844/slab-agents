import "server-only";

import { emailAutomationBlockReason } from "@/lib/email-automation-policy";
import {
  assertAgentEmailConnectorReady,
  getInboundEmailAccount,
} from "@/lib/integrations/email-service";
import { OperationalError } from "@/lib/operational-error";

export async function assertEmailAutomationTarget(
  agentId: string,
  accountId: string,
) {
  const blocked = emailAutomationBlockReason(agentId, accountId);
  if (blocked)
    throw new OperationalError(blocked, "EMAIL_AUTOMATION_BLOCKED", 409);
  assertAgentEmailConnectorReady(agentId);
  return getInboundEmailAccount(accountId);
}
