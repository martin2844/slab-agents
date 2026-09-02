import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { automationExecutionRepository } from "@/lib/repositories/automation-execution-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { agentToolPolicyRepository } from "@/lib/repositories/agent-tool-policy-repository";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { listKnowledgeSources } from "@/lib/sources/service";

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
import { buildAgentToolCatalog } from "@/lib/agent-tool-catalog";
import { getEmailIntegrationState } from "@/lib/integrations/email-service";
import { emailAutomationBlockReason } from "@/lib/email-automation-policy";
import { getTodayUsagePulse } from "@/lib/usage-summary";
import {
  summarizeAgentOverview,
  summarizeWorkOverview,
  unavailableWorkOverview,
} from "@/lib/overview-summary";

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
      return summarizeWorkOverview(issues, relationshipBlocked);
    } catch {
      return unavailableWorkOverview();
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
  const currentTime = new Date();
  const agents = agentRepository.listAgents(),
    runs = runRepository.listRuns(),
    automations = automationRepository.listAutomations(),
    integrations = integrationRepository.listIntegrations(),
    approvals = approvalRepository.list("pending");
  const work = await loadWorkOverview();
  const activeAutomations = automations.filter(
    (automation) => automation.enabled,
  );
  const usageToday = loadOverviewUsage(currentTime);
  const failureWindowStart = currentTime.getTime() - 86_400_000;

  return {
    agents: summarizeAgentOverview(agents, runs),
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
    automations: activeAutomations,
    attention: {
      approvals: approvals.length,
      failedRuns: runs.filter(
        (run) =>
          run.status === "failed" &&
          new Date(run.completedAt ?? run.createdAt).getTime() >=
            failureWindowStart,
      ).length,
      blockedWork: work.blocked,
      reviewWork: work.review,
      workUnavailable: !work.connected,
      integrationIssues: integrations.filter(
        (integration) => integration.enabled && integration.status === "failed",
      ).length,
    },
    activeRuns: runs.filter((run) =>
      ["running", "queued", "waiting_approval"].includes(run.status),
    ),
    recentRuns: runs.slice(0, 6),
    usageToday: {
      available: usageToday !== null,
      trackedUsd: usageToday?.trackedUsd ?? 0,
      totalTokens: usageToday?.totalTokens ?? 0,
      unpricedTokens: usageToday?.unpricedTokens ?? 0,
    },
    upcomingAutomations: activeAutomations
      .map((automation) => ({
        id: automation.id,
        name: automation.name,
        agentId: automation.agentId,
        triggerType: automation.triggerType,
        nextRunAt: automation.nextRunAt,
      }))
      .sort((left, right) => {
        if (left.nextRunAt === null) return 1;
        if (right.nextRunAt === null) return -1;
        return left.nextRunAt.localeCompare(right.nextRunAt);
      }),
    setup: getSetupStatus(),
    agentsList: agents,
  };
}

function loadOverviewUsage(currentTime: Date) {
  try {
    return getTodayUsagePulse(currentTime);
  } catch {
    return null;
  }
}

export function getAgentDetailPageData(
  id: string,
): Omit<AgentDetailData, "runtimes" | "email"> | null {
  const agent = agentRepository.getAgent(id);
  if (!agent) return null;
  const integrations = integrationRepository.listIntegrations();
  return {
    agent,
    knowledgeSources: listKnowledgeSources(),
    integrations,
    toolPolicies: agentToolPolicyRepository.listForAgent(agent.id),
    toolCatalog: buildAgentToolCatalog({
      agent,
      integrations,
      emailAccess: emailAccessRepository.getAgentEmailAccess(agent.id),
    }),
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
  const runs = runRepository.listRuns();
  const approvals = [
    ...approvalRepository.list("pending"),
    ...approvalRepository.listRecent(),
  ];
  return {
    runs,
    approvals: [
      ...new Map(approvals.map((approval) => [approval.id, approval])).values(),
    ],
    agents: agentRepository.listAgents(),
    conversations: conversationRepository
      .listThreadsByIds(
        runs.flatMap((run) => (run.threadId ? [run.threadId] : [])),
      )
      .map(({ id, agentId, title }) => ({ id, agentId, title })),
  };
}

export function getRunsActivityData(): Partial<RunsData> {
  const runs = runRepository.listRuns(20);
  return {
    runs,
    approvals: approvalRepository.list("pending"),
    conversations: conversationRepository
      .listThreadsByIds(
        runs.flatMap((run) => (run.threadId ? [run.threadId] : [])),
      )
      .map(({ id, agentId, title }) => ({ id, agentId, title })),
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

export async function getAutomationsPageData(): Promise<AutomationsData> {
  const email = await getEmailIntegrationState();
  const feedError = automationRepository.getEmailFeedState()?.lastError;
  const dispatchWarning = automationRepository.getEmailDispatchWarning();
  const pendingDispatchError = dispatchWarning
    ? dispatchWarning.status === "pending"
      ? `“${dispatchWarning.automationName}” event ${dispatchWarning.inboundEventId} is waiting to retry: ${dispatchWarning.error}${dispatchWarning.nextAttemptAt ? ` Next attempt after ${dispatchWarning.nextAttemptAt}.` : ""}`
      : `“${dispatchWarning.automationName}” event ${dispatchWarning.inboundEventId} stopped after repeated dispatch failures: ${dispatchWarning.error}`
    : null;
  return {
    automations: automationRepository.listAutomations(),
    executions: automationExecutionRepository.listRecentWithSteps(),
    agents: agentRepository.listAgents(),
    emailAccounts: email.accounts.filter(
      (account) => account.enabled && account.capabilities.read,
    ),
    emailAccess: email.assignments.map((access) => ({
      agentId: access.agentId,
      accountIds: access.accountIds.filter(
        (accountId) =>
          emailAutomationBlockReason(access.agentId, accountId) === null,
      ),
      readEnabled: access.readEnabled,
      draftEnabled: access.draftEnabled,
      sendEnabled: access.sendEnabled,
      sendPolicy: access.sendPolicy,
    })),
    emailConfigured:
      email.configured && email.adminConfigured && email.status === "connected",
    emailError: feedError ?? pendingDispatchError ?? email.lastError,
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

export async function getDocsPageData(
  preferredDocumentId?: string,
): Promise<DocsPageData> {
  try {
    const documents = await DocsClient.listWorkspace();
    const selected =
      documents.find((document) => document.id === preferredDocumentId)?.id ??
      documents[0]?.id ??
      null;
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
