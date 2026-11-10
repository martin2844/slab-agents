import "server-only";

import { conflict, notFound } from "@/lib/api";
import { isCodingStageAgent } from "@/lib/coding/agents";
import { WorkClient } from "@/lib/mcp/work-client";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { codingRepository } from "@/lib/repositories/coding-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { resolveAgent } from "@/lib/work-coordination";

export type WorkChatTarget =
  | { kind: "thread"; agentId: string; agentName: string; url: string }
  | { kind: "coding"; agentId: string; agentName: string; url: string; runNumber: number };

/**
 * Opens a conversation with the agent assigned to a Work item. Plain agents get the
 * item's thread (the same one its Work runs use). Coding agents get the chat of the
 * item's coding run, because only that run has the repository checkout.
 */
export async function openWorkChat(
  issueKey: string,
  getIssue: (key: string) => Promise<{ key: string; title: string; assignee?: string | null }> = WorkClient.getIssue,
): Promise<WorkChatTarget> {
  const issue = await getIssue(issueKey);
  const agent = resolveAgent(agentRepository.listAgents(), issue.assignee);
  if (!agent) throw notFound(`${issue.key} is not assigned to an agent.`);
  if (!agent.enabled) throw conflict(`${agent.name} is disabled.`, "AGENT_DISABLED");
  if (isCodingStageAgent(agent.id)) {
    const run = codingRepository
      .listRunsForIssue(issue.key)
      .find((item) => item.status !== "cancelled" && item.workspaceStatus === "ready");
    if (!run)
      throw conflict(
        `${agent.name} works only inside coding runs. Start a coding run for ${issue.key} first.`,
        "NO_CODING_RUN",
      );
    return {
      kind: "coding",
      agentId: agent.id,
      agentName: agent.name,
      runNumber: run.number,
      url: `/coding/${run.id}?stage=chat`,
    };
  }
  const thread = conversationRepository.getOrCreateWorkAgentThread(
    issue.key,
    agent.id,
    `${issue.key} · ${issue.title}`,
  );
  return {
    kind: "thread",
    agentId: agent.id,
    agentName: agent.name,
    url: `/agents/${agent.id}/threads/${thread.id}`,
  };
}

/** Extra instructions for a chat in a Work item's thread. */
export function workChatInstructions(issueKey: string) {
  return [
    `This conversation is about Work item ${issueKey}, which is assigned to you. The human talks to you here to unblock or steer it.`,
    `Before you answer, read ${issueKey}: its description, status, comments, and links, plus the Docs it points to.`,
    "Answer the human, then act on what they decide: advance, unblock, or finish the item within your normal tools and limits.",
    `Record decisions and results as a comment on ${issueKey}, and update its status when it changes.`,
  ].join("\n");
}
