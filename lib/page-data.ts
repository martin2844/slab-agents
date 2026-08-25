import "server-only";

import { DocsClient } from "@/lib/mcp/docs-client";
import { WorkClient } from "@/lib/mcp/work-client";
import { repository } from "@/lib/repository";
import { approvalStore } from "@/lib/repositories/approval-store";
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
let workOverviewCache:
  | { expiresAt: number; value: WorkOverview }
  | undefined;
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
          (issue) => issue.status === "in_progress" || issue.status === "review",
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
  const agents = repository.listAgents(),
    runs = repository.listRuns(),
    automations = repository.listAutomations(),
    integrations = repository.listIntegrations(),
    approvals = approvalStore.list("pending"),
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
  const agent = repository.getAgent(id);
  if (!agent) return null;
  return {
    agent,
    integrations: repository.listIntegrations(),
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
  const approvals = [
    ...approvalStore.list("pending"),
    ...approvalStore.listRecent(),
  ];
  return {
    runs: repository.listRuns(),
    approvals: [
      ...new Map(approvals.map((approval) => [approval.id, approval])).values(),
    ],
    agents: repository.listAgents(),
  };
}

export function getRunsActivityData(): Partial<RunsData> {
  return {
    runs: repository.listRuns(20),
    approvals: approvalStore.list("pending"),
  };
}

export function getRunDetailPageData(id: string): RunDetailData | null {
  const run = repository.getRun(id);
  if (!run) return null;
  const events = repository.listRunEvents(id);
  return {
    run,
    events,
    approvals: approvalStore.listForRun(id),
    contextProfile: buildRunContextProfile(run, events),
    budget: getRunBudget(id),
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
    integrations: repository
      .listIntegrations()
      .filter((integration) => !integration.provider.startsWith("calendar_")),
    agents: repository.listAgents(),
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
