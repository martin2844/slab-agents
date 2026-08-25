import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";

import { DocsClient } from "@/lib/mcp/docs-client";
import { WorkClient } from "@/lib/mcp/work-client";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { getPublicSettings } from "@/lib/settings";
import { INTEGRATION_CATALOG } from "@/lib/integrations/catalog";
import { externalServiceUrl, getSetupStatus } from "@/lib/setup";
import { buildRunContextProfile } from "@/lib/run-context-profile";
import type {
  AgentDetailData,
  AutomationsData,
  DocsPageData,
  IntegrationsPageData,
  OperatorPacksPageData,
  OverviewData,
  RunDetailData,
  RunsData,
  ThreadData,
  WorkPageData,
} from "@/lib/types";
import { getRunBudget } from "@/lib/budget-control";
import {
  getOperatorPackSummaries,
  operatorPackMetrics,
} from "@/lib/packs/service";
import { mapWithConcurrency } from "@/lib/async";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

type WorkOverview = OverviewData["work"];
const OVERVIEW_WORK_TTL_MS = 15_000;
let workOverviewCache: { expiresAt: number; value: WorkOverview } | undefined;
let workOverviewInFlight: Promise<WorkOverview> | undefined;

async function loadWorkOverview(): Promise<WorkOverview> {
  if (workOverviewCache && workOverviewCache.expiresAt > Date.now()) {
    return workOverviewCache.value;
  }
  if (workOverviewInFlight) return workOverviewInFlight;
  workOverviewInFlight = (async () => {
    try {
      const projects = await WorkClient.listProjects();
      const issues = (
        await mapWithConcurrency(projects, 4, (project) =>
          WorkClient.listIssues(project.key),
        )
      ).flat();
      const relationshipBlocked = await WorkClient.getBlockedIssues();
      const blockedKeys = new Set([
        ...relationshipBlocked.map((issue) => issue.key),
        ...issues
          .filter((issue) => issue.status === "blocked")
          .map((issue) => issue.key),
      ]);
      return {
        open: issues.filter((issue) => issue.status !== "done").length,
        inProgress: issues.filter(
          (issue) =>
            issue.status === "in_progress" || issue.status === "review",
        ).length,
        blocked: blockedKeys.size,
        review: issues.filter((issue) => issue.status === "review").length,
        connected: true,
      };
    } catch {
      return {
        open: 0,
        inProgress: 0,
        blocked: 0,
        review: 0,
        connected: false,
      };
    }
  })();
  try {
    const value = await workOverviewInFlight;
    workOverviewCache = {
      value,
      expiresAt: Date.now() + OVERVIEW_WORK_TTL_MS,
    };
    return value;
  } finally {
    workOverviewInFlight = undefined;
  }
}

export async function getOverviewPageData(): Promise<OverviewData> {
  const agents = agentRepository.listAgents(),
    runs = runRepository.listRuns(),
    automations = automationRepository.listAutomations(),
    integrations = integrationRepository.listIntegrations(),
    approvals = approvalRepository.list("pending"),
    runningAgentIds = new Set(
      runs.filter((run) => run.status === "running").map((run) => run.agentId),
    );
  const work = await loadWorkOverview();

  return {
    agents: {
      total: agents.length,
      running: runningAgentIds.size,
      queued: runs.filter((run) => run.status === "queued").length,
      waitingApproval: runs.filter((run) => run.status === "waiting_approval")
        .length,
      idle:
        agents.filter((agent) => agent.enabled).length - runningAgentIds.size,
    },
    work,
    integrations: {
      total: integrations.length,
      healthy: integrations.filter(
        (integration) =>
          integration.enabled && integration.status === "connected",
      ).length,
      issues: integrations.filter(
        (integration) => integration.enabled && integration.status === "failed",
      ).length,
    },
    automations: automations.filter((automation) => automation.enabled),
    attention: {
      approvals: approvals.length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
      blockedWork: work.blocked,
      reviewWork: work.review,
      integrationIssues: integrations.filter(
        (integration) => integration.enabled && integration.status === "failed",
      ).length,
    },
    activeRuns: runs.filter((run) =>
      ["running", "queued", "waiting_approval"].includes(run.status),
    ),
    recentRuns: runs.slice(0, 6),
    setup: getSetupStatus(),
    agentsList: agents,
  };
}

export function getAgentDetailPageData(
  id: string,
): Omit<AgentDetailData, "runtimes"> | null {
  const agent = agentRepository.getAgent(id);
  if (!agent) return null;
  return {
    agent,
    integrations: integrationRepository.listIntegrations(),
    quickActions: agentRepository.listAgentQuickActions(agent.id),
    threads: conversationRepository.listThreads(agent.id),
    automations: automationRepository
      .listAutomations()
      .filter((automation) => automation.agentId === agent.id),
    runs: runRepository
      .listRuns()
      .filter((run) => run.agentId === agent.id)
      .slice(0, 10),
  };
}

export function getThreadPageData(id: string): ThreadData | null {
  const thread = conversationRepository.getThread(id);
  if (!thread) return null;
  const agent = agentRepository.getAgent(thread.agentId);
  if (!agent) return null;
  return { thread, agent, messages: conversationRepository.listMessages(id) };
}

export function getRunsPageData(): RunsData {
  const approvals = [
    ...approvalRepository.list("pending"),
    ...approvalRepository.listRecent(),
  ];
  return {
    runs: runRepository.listRuns(),
    approvals: [
      ...new Map(approvals.map((approval) => [approval.id, approval])).values(),
    ],
    agents: agentRepository.listAgents(),
  };
}

export function getRunsActivityData(): Partial<RunsData> {
  return {
    runs: runRepository.listRuns(20),
    approvals: approvalRepository.list("pending"),
  };
}

export function getRunDetailPageData(id: string): RunDetailData | null {
  const run = runRepository.getRun(id);
  if (!run) return null;
  const events = runRepository.listRunEvents(id);
  return {
    run,
    events,
    approvals: approvalRepository.listForRun(id),
    contextProfile: buildRunContextProfile(run, events),
    budget: getRunBudget(id),
  };
}

export function getAutomationsPageData(): AutomationsData {
  return {
    automations: automationRepository.listAutomations(),
    agents: agentRepository.listAgents(),
  };
}

export function getIntegrationsPageData(): IntegrationsPageData {
  return {
    integrations: integrationRepository
      .listIntegrations()
      .filter((integration) => !integration.provider.startsWith("calendar_")),
    agents: agentRepository.listAgents(),
    catalog: INTEGRATION_CATALOG,
  };
}

export async function getOperatorPacksPageData(): Promise<OperatorPacksPageData> {
  return {
    packs: await getOperatorPackSummaries(),
    metrics: operatorPackMetrics(),
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
      agents: agentRepository.listAgents().filter((agent) => agent.enabled),
      error: "",
      externalUrl,
    };
  } catch (error) {
    return {
      projects: [],
      projectKey: "",
      issues: [],
      agents: agentRepository.listAgents().filter((agent) => agent.enabled),
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
