import "server-only";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import type { WhatsAppAutomationConfig } from "@/lib/whatsapp-automation";
import { assertRuntimeSelectable } from "@/lib/runtime-config";

export function whatsappAutomationBlockReason(
  agentId: string,
  config: WhatsAppAutomationConfig,
) {
  const agent = agentRepository.getAgent(agentId);
  if (!agent?.enabled) return "Choose an enabled agent.";
  if (agent.runtime === "gemini")
    return "Choose Codex, Claude or an API runtime for WhatsApp. Gemini CLI does not separate system instructions from incoming chat content.";
  try {
    assertRuntimeSelectable(agent.runtime, agent.model);
  } catch {
    return "Enable and configure this agent's runtime before activating WhatsApp replies.";
  }
  const record =
    integrationRepository.getIntegrationRecordByProvider("whatsapp");
  if (!record?.enabled || record.config.accountEmail !== config.account)
    return "The selected WhatsApp account is disconnected or changed.";
  const tools =
    integrationRepository.listIntegrationPermissions(record.id)[agentId] ?? [];
  if (
    !tools.includes("whatsapp_get_messages") ||
    !tools.includes("whatsapp_send_text")
  )
    return "Grant this agent WhatsApp read and send access before activating replies.";
  return null;
}
