import "server-only";

import { DocsClient } from "@/lib/mcp/docs-client";
import { WorkClient } from "@/lib/mcp/work-client";
import { repository } from "@/lib/repository";
import { getPublicSettings } from "@/lib/settings";
import { INTEGRATION_CATALOG } from "@/lib/integrations/catalog";
import { externalServiceUrl, getSetupStatus } from "@/lib/setup";
import type {
  AgentDetailData,
  AutomationsData,
  DocsPageData,
  IntegrationsPageData,
  OverviewData,
  RunDetailData,
  RunsData,
  ThreadData,
  WorkPageData,
} from "@/lib/types";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

export async function getOverviewPageData(): Promise<OverviewData> {
  const agents = repository.listAgents(),
    runs = repository.listRuns(),
    automations = repository.listAutomations(),
    approvals = repository.listApprovals("pending"),
    runningAgentIds = new Set(
      runs.filter((run) => run.status === "running").map((run) => run.agentId),
    );
  let work = { open: 0, inProgress: 0, blocked: 0, connected: true };

  try {
    const projects = await WorkClient.listProjects();
    const issues = (
      await Promise.all(
        projects.map((project) => WorkClient.listIssues(project.key)),
      )
    ).flat();
    const relationshipBlocked = await WorkClient.getBlockedIssues();
    const blockedKeys = new Set([
      ...relationshipBlocked.map((issue) => issue.key),
      ...issues
        .filter((issue) => issue.status === "blocked")
        .map((issue) => issue.key),
    ]);
    work = {
      open: issues.filter((issue) => issue.status !== "done").length,
      inProgress: issues.filter(
        (issue) => issue.status === "in_progress" || issue.status === "review",
      ).length,
      blocked: blockedKeys.size,
      connected: true,
    };
  } catch {
    work.connected = false;
  }

  return {
    agents: {
      total: agents.length,
      running: runningAgentIds.size,
      idle:
        agents.filter((agent) => agent.enabled).length - runningAgentIds.size,
    },
    work,
    automations: automations.filter((automation) => automation.enabled),
    attention: {
      approvals: approvals.length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
    },
    recentRuns: runs.slice(0, 6),
    setup: getSetupStatus(),
    agentsList: agents,
  };
}

export function getAgentDetailPageData(id: string): AgentDetailData | null {
  const agent = repository.getAgent(id);
  if (!agent) return null;
  return {
    agent,
    quickActions: repository.listAgentQuickActions(agent.id),
    threads: repository.listThreads(agent.id),
    automations: repository
      .listAutomations()
      .filter((automation) => automation.agentId === agent.id),
    runs: repository
      .listRuns()
      .filter((run) => run.agentId === agent.id)
      .slice(0, 10),
  };
}

export function getThreadPageData(id: string): ThreadData | null {
  const thread = repository.getThread(id);
  if (!thread) return null;
  const agent = repository.getAgent(thread.agentId);
  if (!agent) return null;
  return { thread, agent, messages: repository.listMessages(id) };
}

export function getRunsPageData(): RunsData {
  return {
    runs: repository.listRuns(),
    approvals: repository.listApprovals(),
  };
}

export function getRunDetailPageData(id: string): RunDetailData | null {
  const run = repository.getRun(id);
  if (!run) return null;
  return {
    run,
    events: repository.listRunEvents(id),
    approvals: repository
      .listApprovals()
      .filter((approval) => approval.runId === id),
  };
}

export function getAutomationsPageData(): AutomationsData {
  return {
    automations: repository.listAutomations(),
    agents: repository.listAgents(),
  };
}

export function getIntegrationsPageData(): IntegrationsPageData {
  return {
    integrations: repository.listIntegrations(),
    agents: repository.listAgents(),
    catalog: INTEGRATION_CATALOG,
  };
}

export async function getWorkPageData(): Promise<WorkPageData> {
  const externalUrl = externalServiceUrl(getPublicSettings().workMcpUrl);
  try {
    const projects = await WorkClient.listProjects();
    const projectKey = projects[0]?.key ?? "";
    const issues = projectKey ? await WorkClient.listIssues(projectKey) : [];
    return {
      projects,
      projectKey,
      issues,
      agents: repository.listAgents().filter((agent) => agent.enabled),
      error: "",
      externalUrl,
    };
  } catch (error) {
    return {
      projects: [],
      projectKey: "",
      issues: [],
      agents: repository.listAgents().filter((agent) => agent.enabled),
      error: errorMessage(error),
      externalUrl,
    };
  }
}

export async function getDocsPageData(): Promise<DocsPageData> {
  try {
    const documents = await DocsClient.list();
    const selected = documents[0]?.id ?? null;
    const detail = selected
      ? await Promise.all([
          DocsClient.get(selected),
          DocsClient.revisions(selected),
        ]).then(([document, revisions]) => ({ document, revisions }))
      : null;
    return { documents, selected, detail, error: "" };
  } catch (error) {
    return {
      documents: [],
      selected: null,
      detail: null,
      error: errorMessage(error),
    };
  }
}
