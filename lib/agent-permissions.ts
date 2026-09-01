import type { Agent, AgentPermissionMode } from "@/lib/types";

export function effectiveAgentPermissionMode(
  agent: Pick<Agent, "permissionMode" | "fullAccess">,
): AgentPermissionMode {
  return agent.permissionMode ?? (agent.fullAccess ? "full" : "guarded");
}

export function usesUnrestrictedRuntime(mode: AgentPermissionMode) {
  return mode === "full" || mode === "yolo";
}
