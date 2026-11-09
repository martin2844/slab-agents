import "server-only";

import type { AgentToolCatalogServer } from "@/lib/types";
import type { McpToolPolicy } from "@/lib/agent-tool-policy";
import { autonomyLimits, capability } from "@/lib/autonomy/service";
import { autonomyRepository } from "@/lib/repositories/autonomy-repository";
import type { RunTrigger } from "@/lib/run-execution";

/** Tools that always ask a human, at every autonomy level. */
export const RED_LINE_TOOLS = new Set([
  "delete_issue",
  "archive_doc",
  "archive_collection",
  "revert_doc_commit",
  "calendar_cancel_event",
]);

/**
 * Servers whose tools Slab knows. Tools of custom integrations (custom MCP or HTTP,
 * WhatsApp) can merge, pay, or release; automatic approvals never cover them.
 */
function knownServer(serverName: string) {
  return (
    ["work", "docs", "email", "work_posthog"].includes(serverName) ||
    serverName.startsWith("calendar_") ||
    serverName.startsWith("google_")
  );
}

/** Messages that start a conversation (outbound), as opposed to replies. */
const OUTBOUND_TOOLS: Record<string, (serverName: string, trigger: RunTrigger | null) => boolean> = {
  email_send: (serverName) => serverName === "email",
  // In WhatsApp-triggered runs the send is the reply; its own reply policy governs it.
  whatsapp_send_text: (serverName, trigger) => serverName.startsWith("whatsapp_") && trigger !== "whatsapp",
};

function modeFor(policy: McpToolPolicy, tool: string) {
  return policy.tools[tool] ?? policy.defaultMode;
}

/**
 * Applies the autonomy policy to a run's tool policies. At level 1 (outbound
 * "policy", tool approvals "policy") it changes nothing.
 */
export function applyAutonomyToolPolicies(
  policies: Record<string, McpToolPolicy>,
  input: { agentId: string; trigger: RunTrigger | null; catalog: AgentToolCatalogServer[] },
) {
  let outbound = capability("outbound", input.agentId);
  // The daily cap of automatic outbound messages (checked when each run starts).
  if (
    outbound === "auto" &&
    autonomyRepository.outboundSendsSince(new Date(Date.now() - 24 * 3_600_000).toISOString()) >=
      autonomyLimits().outboundDailyCap
  ) {
    outbound = "approval";
  }
  const approvals = capability("tool_approvals", input.agentId);
  // The Slab control server is governed by the autonomy policy itself (each tool checks its capability).
  if (policies.slab) policies = { ...policies, slab: { defaultMode: "approve", tools: {} } };
  if (outbound === "policy" && approvals === "policy") return policies;
  const result: Record<string, McpToolPolicy> = {};
  for (const [serverName, policy] of Object.entries(policies)) {
    // The control server is already set; WhatsApp replies keep their own reply policy.
    if (serverName === "slab" || (input.trigger === "whatsapp" && serverName.startsWith("whatsapp_"))) {
      result[serverName] = policy;
      continue;
    }
    const catalogTools =
      input.catalog.find((server) => server.serverName === serverName)?.tools ?? [];
    const names = new Set([...Object.keys(policy.tools), ...catalogTools.map(({ name }) => name)]);
    const tools: Record<string, McpToolPolicy["defaultMode"]> = { ...policy.tools };
    // Never above an explicit cap (for example an email send policy that requires approval).
    const capped = (name: string, mode: McpToolPolicy["defaultMode"]) =>
      mode === "approve" && catalogTools.find((tool) => tool.name === name)?.maximumMode === "prompt" ? "prompt" : mode;
    let defaultMode = policy.defaultMode;
    if (approvals === "auto" && knownServer(serverName)) {
      for (const name of names) {
        const destructive = catalogTools.find((tool) => tool.name === name)?.sensitiveAction === "destructive";
        const current = modeFor(policy, name);
        if (RED_LINE_TOOLS.has(name) || destructive) tools[name] = current === "deny" ? "deny" : "prompt";
        else if (current === "prompt") tools[name] = capped(name, "approve");
      }
      if (defaultMode === "prompt") defaultMode = "approve";
      // Tools not in the catalog keep asking: Slab cannot tell whether they are red lines.
      if (!catalogTools.length && policy.defaultMode === "prompt") defaultMode = "prompt";
    }
    for (const [tool, isOutbound] of Object.entries(OUTBOUND_TOOLS)) {
      if (!isOutbound(serverName, input.trigger)) continue;
      const current = modeFor(policy, tool);
      if (current === "deny" && outbound !== "off") continue; // Never grant a tool the agent does not have.
      if (outbound === "off") tools[tool] = "deny";
      else if (outbound === "approval") tools[tool] = "prompt";
      else if (outbound === "auto") tools[tool] = capped(tool, "approve");
      else tools[tool] = current; // policy: the agent's own setting, even when approvals are automatic.
    }
    result[serverName] = { defaultMode, tools };
  }
  return result;
}
