import "server-only";

import { badRequest, conflict, notFound } from "@/lib/api";
import { codingRepository, type RepositoryInput } from "@/lib/repositories/coding-repository";
import { codeRunner } from "@/lib/coding/code-runner";
import { ensureCodingAgents, stageAgentMapping } from "@/lib/coding/agents";
import { listPullRequestFeedback, replyToFeedback } from "@/lib/coding/github";
import {
  publishRun,
  queueStage,
  stopStageRun,
  type StageInput,
} from "@/lib/coding/orchestrator";
import {
  isPipelineStage,
  PIPELINE_STAGES,
  STAGE_DEFINITIONS,
  type CodingStage,
} from "@/lib/coding/stages";
import type {
  CodeFeedbackItem,
  CodeRun,
  CodeRunStage,
  CodeRunSummary,
} from "@/lib/coding/types";
import { syncRunStarted, syncRunStopped } from "@/lib/coding/work-sync";
import { WorkClient } from "@/lib/mcp/work-client";
import { sourceRepository } from "@/lib/repositories/source-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Repositories

function normalizeRepositoryInput(input: RepositoryInput): RepositoryInput {
  const optional = (value: string | null) => (value?.trim() ? value.trim() : null);
  const owner = input.owner.trim();
  const name = input.name.trim().replace(/\.git$/, "");
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) throw badRequest("The repository owner is not valid.");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || /^\.+$/.test(name))
    throw badRequest("The repository name is not valid.");
  if (!input.defaultBranch.trim()) throw badRequest("The default branch is required.");
  const app = sourceRepository.getGithubApp(input.sourceAppId);
  if (!app) throw badRequest("Choose a connected GitHub App.");
  if (app.status !== "connected" || !app.installationId)
    throw badRequest("The GitHub App is not installed. Finish its installation in Sources.");
  return {
    ...input,
    owner,
    name,
    defaultBranch: input.defaultBranch.trim(),
    setupCommand: optional(input.setupCommand),
    testCommand: optional(input.testCommand),
    lintCommand: optional(input.lintCommand),
    typecheckCommand: optional(input.typecheckCommand),
    workProjectKey: optional(input.workProjectKey)?.toUpperCase() ?? null,
    setupNotes: input.setupNotes ?? "",
  };
}

export function createCodeRepository(input: RepositoryInput) {
  const normalized = normalizeRepositoryInput(input);
  if (
    codingRepository
      .listRepositories()
      .some((repo) => repo.owner === normalized.owner && repo.name === normalized.name)
  ) {
    throw conflict("This repository is already configured.");
  }
  return codingRepository.createRepository(normalized);
}

export function updateCodeRepository(id: string, input: RepositoryInput) {
  const existing = codingRepository.getRepository(id);
  if (!existing) throw notFound("Repository not found.");
  const normalized = normalizeRepositoryInput(input);
  const sameIdentity =
    normalized.owner === existing.owner &&
    normalized.name === existing.name &&
    normalized.sourceAppId === existing.sourceAppId;
  if (!sameIdentity) {
    // Open runs cloned this repository; never publish them to another one.
    if (codingRepository.listOpenRuns().some((run) => run.repositoryId === id))
      throw conflict("Coding runs are open on this repository. Finish or cancel them before you change it.");
    if (
      codingRepository
        .listRepositories()
        .some((repo) => repo.id !== id && repo.owner === normalized.owner && repo.name === normalized.name)
    ) {
      throw conflict("This repository is already configured.");
    }
  }
  return codingRepository.updateRepository(id, normalized)!;
}

export function deleteCodeRepository(id: string) {
  if (!codingRepository.getRepository(id)) throw notFound("Repository not found.");
  if (!codingRepository.deleteRepository(id))
    throw conflict("Coding runs use this repository. Disable it instead of deleting it.");
}

// ---------------------------------------------------------------------------
// Runs

export async function startCodingRun(input: {
  issueKey: string;
  repositoryId: string;
  note?: string;
}) {
  const issueKey = input.issueKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) throw badRequest("Choose a Work item.");
  const repository = codingRepository.getRepository(input.repositoryId);
  if (!repository || !repository.enabled) throw badRequest("Choose an enabled repository.");
  const open = codingRepository
    .listRunsForIssue(issueKey)
    .find((run) => ["preparing", "active", "waiting"].includes(run.status));
  if (open) throw conflict(`Coding run #${open.number} is already open for ${issueKey}.`);
  const issue = await WorkClient.getIssue(issueKey).catch(() => null);
  if (!issue) throw notFound(`Work item ${issueKey} was not found.`);
  ensureCodingAgents();
  const missing = stageAgentMapping().filter(({ agent }) => !agent || !agent.enabled);
  if (missing.length) {
    throw badRequest(
      `Assign enabled agents to these stages in Coding settings: ${missing.map(({ stage }) => STAGE_DEFINITIONS[stage].name).join(", ")}.`,
    );
  }
  const run = codingRepository.createRun({
    issueKey,
    title: issue.title,
    repositoryId: repository.id,
    note: input.note?.trim() ?? "",
  });
  void syncRunStarted(run, repository.fullName);
  return run;
}

function requireRun(id: string) {
  const run = codingRepository.getRun(id);
  if (!run) throw notFound("Coding run not found.");
  return run;
}

function requireStage(run: CodeRun, stageId: string) {
  const stage = codingRepository.getStage(stageId);
  if (!stage || stage.codeRunId !== run.id) throw notFound("Stage not found.");
  return stage;
}

function assertOpen(run: CodeRun) {
  if (run.status === "cancelled") throw conflict("This coding run was cancelled.");
  if (run.workspaceStatus !== "ready") throw conflict("The workspace is not ready yet.");
}

/** Approve a stage that waits for the user (spec, failed plan, failed checks, publish). */
export function approveStage(runId: string, stageId: string) {
  const run = requireRun(runId);
  assertOpen(run);
  const stage = requireStage(run, stageId);
  if (stage.status !== "waiting_approval") throw conflict("This stage is not waiting for approval.");
  if (stage.stage === "pr_feedback") throw badRequest("Use the PR feedback actions for this stage.");
  codingRepository.updateStage(stage.id, { status: "done", finishedAt: now() });
  if (run.status === "waiting") codingRepository.updateRun(run.id, { status: "active" });
  return codingRepository.getRun(run.id)!;
}

/** Answer questions or request changes: the same stage continues in the same conversation. */
export async function replyToStage(runId: string, stageId: string, message: string) {
  const run = requireRun(runId);
  assertOpen(run);
  const stage = requireStage(run, stageId);
  const text = message.trim();
  if (!text) throw badRequest("Write a message.");
  if (stage.stage === "publish") throw badRequest("The publish step has no conversation.");
  if (["queued", "running"].includes(stage.status))
    throw conflict("The stage is still running. Wait for it, or stop it first.");
  if (stage.superseded) throw conflict("This stage attempt was replaced by a newer one.");
  // A user reply on a completed pipeline stage invalidates the stages after it.
  if (isPipelineStage(stage.stage)) {
    const later = PIPELINE_STAGES.slice(PIPELINE_STAGES.indexOf(stage.stage) + 1);
    for (const item of codingRepository.listStages(run.id)) {
      if (!item.superseded && later.includes(item.stage as (typeof PIPELINE_STAGES)[number])) {
        if (["queued", "running"].includes(item.status)) await stopStageRun(item);
      }
    }
    codingRepository.supersedeStages(run.id, later);
    codingRepository.updateRun(run.id, { currentStage: stage.stage, status: "active", finishedAt: null });
  }
  queueStage(stage, { pendingMessage: text, autoRetries: 0 });
  return codingRepository.getRun(run.id)!;
}

/** Re-run a pipeline stage from scratch; it and every later stage get a new attempt. */
export async function rerunFrom(runId: string, stage: CodingStage) {
  const run = requireRun(runId);
  assertOpen(run);
  if (!isPipelineStage(stage)) throw badRequest("Only pipeline stages can be re-run.");
  const later = PIPELINE_STAGES.slice(PIPELINE_STAGES.indexOf(stage));
  for (const item of codingRepository.listStages(run.id)) {
    if (!item.superseded && later.includes(item.stage as (typeof PIPELINE_STAGES)[number])) {
      if (item.status === "running") await stopStageRun(item);
    }
  }
  codingRepository.supersedeStages(run.id, later);
  codingRepository.createStage({ codeRunId: run.id, stage });
  return codingRepository.updateRun(run.id, {
    currentStage: stage,
    status: "active",
    error: null,
    finishedAt: null,
  });
}

export async function stopStage(runId: string, stageId: string) {
  const run = requireRun(runId);
  const stage = requireStage(run, stageId);
  if (!["queued", "running"].includes(stage.status)) throw conflict("This stage is not running.");
  await stopStageRun(stage);
  codingRepository.updateStage(stage.id, {
    status: "cancelled",
    summary: "Stopped by the user.",
    finishedAt: now(),
  });
  return codingRepository.getRun(run.id)!;
}

export async function cancelCodingRun(runId: string) {
  const run = requireRun(runId);
  if (["done", "cancelled"].includes(run.status) && run.workspaceStatus === "deleted") return run;
  for (const stage of codingRepository.listStages(run.id)) {
    if (["queued", "running"].includes(stage.status)) await stopStageRun(stage);
    if (["queued", "running", "waiting_approval", "needs_input"].includes(stage.status)) {
      codingRepository.updateStage(stage.id, { status: "cancelled", finishedAt: now() });
    }
  }
  const updated = codingRepository.updateRun(run.id, {
    status: run.status === "done" ? "done" : "cancelled",
    finishedAt: run.finishedAt ?? now(),
  });
  if (run.status !== "done") void syncRunStopped(updated, "cancelled by the user.");
  return updated;
}

export async function deleteCodingWorkspace(runId: string) {
  const run = requireRun(runId);
  if (["preparing", "active", "waiting"].includes(run.status))
    throw conflict("Cancel the run before you delete its workspace.");
  await codeRunner.deleteWorkspace(run.workspaceId);
  return codingRepository.updateRun(run.id, { workspaceStatus: "deleted" });
}

/** Send a message to the run chat. Changes stay local until the user publishes them. */
export function sendChatMessage(runId: string, message: string) {
  const run = requireRun(runId);
  assertOpen(run);
  const text = message.trim();
  if (!text) throw badRequest("Write a message.");
  let chat = codingRepository.currentStage(run.id, "chat");
  if (chat && ["queued", "running"].includes(chat.status))
    throw conflict("The run chat is still answering.");
  chat ??= codingRepository.createStage({ codeRunId: run.id, stage: "chat" });
  queueStage(chat, { pendingMessage: text });
  return codingRepository.getStage(chat.id)!;
}

/** Push local changes (chat edits, feedback fixes) to the PR branch. */
export async function publishChanges(runId: string) {
  const run = requireRun(runId);
  assertOpen(run);
  if (!run.prNumber) throw conflict("Open the pull request first: approve the code review stage.");
  const busy = codingRepository
    .listStages(run.id)
    .some((stage) => !stage.superseded && stage.status === "running");
  if (busy) throw conflict("Wait until the running stage finishes.");
  const { result } = await publishRun(run, {
    commitMessage: `[${run.issueKey}] Apply requested changes`,
    openPullRequest: false,
  });
  return result;
}

// ---------------------------------------------------------------------------
// PR feedback

const DECIDED: CodeFeedbackItem["status"][] = [
  "dismissed",
  "no_action",
  "fixed",
  "replied",
  "resolved",
];

export async function checkPullRequestFeedback(runId: string) {
  const run = requireRun(runId);
  assertOpen(run);
  if (!run.prNumber) throw conflict("This run has no pull request yet.");
  const current = codingRepository.currentStage(run.id, "pr_feedback");
  if (current && ["queued", "running"].includes(current.status))
    throw conflict("A feedback round is already running.");
  const repository = codingRepository.getRepository(run.repositoryId)!;
  const remote = await listPullRequestFeedback(repository, run.prNumber);
  // Fold replies into their thread root, so a new reply reopens one item.
  const roots = new Map<number, (typeof remote)[number]>();
  const appBotPattern = /\[bot\]$/;
  for (const item of remote.filter((entry) => entry.kind === "review_comment" && !entry.inReplyTo)) {
    roots.set(Number(item.githubId.split(":")[1]), item);
  }
  for (const reply of remote.filter((entry) => entry.kind === "review_comment" && entry.inReplyTo)) {
    const root = roots.get(reply.inReplyTo!);
    // Replies from people outside the repository never reach the agent.
    if (!root || !reply.trusted) continue;
    root.body = `${root.body}\n\n> Reply by ${reply.author}: ${reply.body}`;
    if (reply.updatedAt > root.updatedAt && !appBotPattern.test(reply.author)) root.updatedAt = reply.updatedAt;
  }
  let created = 0;
  for (const item of [
    ...roots.values(),
    ...remote.filter((entry) => entry.kind !== "review_comment"),
  ]) {
    // Ignore Slab's own posts (the GitHub App).
    if (item.authorIsBot && item.body.includes(`Slab coding run #${run.number}`)) continue;
    const outcome = codingRepository.upsertFeedback({
      codeRunId: run.id,
      githubId: item.githubId,
      kind: item.kind,
      author: item.author,
      authorIsBot: item.authorIsBot,
      path: item.path,
      line: item.line,
      body: item.body.slice(0, 20_000),
      url: item.url,
      reviewCommentId: item.reviewCommentId,
      githubUpdatedAt: item.updatedAt,
      // Bot summaries and comments from people outside the repository (anyone can comment
      // on a public repository) start dismissed; reopen them in the UI to send them to the agent.
      initialStatus:
        !item.trusted || (item.authorIsBot && item.kind !== "review_comment") ? "dismissed" : "new",
    });
    if (outcome !== "unchanged") created += 1;
  }
  const items = codingRepository.listFeedback(run.id);
  const fresh = items.filter((item) => item.status === "new");
  if (!fresh.length) return { started: false, newItems: 0, changed: created };
  await codeRunner.writeHandoff(
    run.workspaceId,
    "feedback-items.json",
    JSON.stringify(
      {
        pullRequest: run.prUrl,
        items: fresh.map((item) => ({
          id: item.id,
          kind: item.kind,
          author: item.author,
          bot: item.authorIsBot,
          path: item.path,
          line: item.line,
          body: item.body,
          url: item.url,
        })),
      },
      null,
      2,
    ),
  );
  const decidedIds = items.filter((item) => DECIDED.includes(item.status)).map((item) => item.id);
  if (current) codingRepository.supersedeStages(run.id, ["pr_feedback"]);
  codingRepository.createStage({
    codeRunId: run.id,
    stage: "pr_feedback",
    input: { feedbackStep: "triage", feedbackDecidedIds: decidedIds } satisfies StageInput,
  });
  return { started: true, newItems: fresh.length, changed: created };
}

export function decideFeedback(
  runId: string,
  decisions: Array<{
    id: string;
    action?: "fix" | "reply" | "no_action";
    reply?: string | null;
    reason?: string | null;
    status?: "dismissed" | "new" | "triaged";
  }>,
) {
  const run = requireRun(runId);
  for (const decision of decisions) {
    const item = codingRepository.getFeedback(decision.id);
    if (!item || item.codeRunId !== run.id) throw notFound("Feedback item not found.");
    codingRepository.updateFeedback(item.id, {
      ...(decision.action ? { action: decision.action } : {}),
      ...(decision.reply !== undefined ? { reply: decision.reply } : {}),
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(decision.status
        ? {
            status: decision.status,
            decidedAt: decision.status === "dismissed" ? now() : null,
          }
        : {}),
    });
  }
  return codingRepository.listFeedback(run.id);
}

/** Start step 2: the agent fixes the accepted items. Items without fixes are decided now. */
export function applyFeedback(runId: string) {
  const run = requireRun(runId);
  assertOpen(run);
  const stage = codingRepository.currentStage(run.id, "pr_feedback");
  if (!stage || stage.status !== "waiting_approval")
    throw conflict("Triage the feedback first.");
  const items = codingRepository.listFeedback(run.id).filter((item) => item.status === "triaged");
  const fixes = items.filter((item) => item.action === "fix");
  for (const item of items.filter((entry) => entry.action === "no_action")) {
    codingRepository.updateFeedback(item.id, { status: "no_action", decidedAt: now() });
  }
  const step = (stage.input as StageInput).feedbackStep;
  if (step === "apply" || !fixes.length) {
    // Nothing to fix (or fixes already applied): finish the round.
    codingRepository.updateStage(stage.id, { status: "done", finishedAt: now() });
    return { applying: false, fixes: fixes.length };
  }
  codingRepository.supersedeStages(run.id, ["pr_feedback"]);
  codingRepository.createStage({
    codeRunId: run.id,
    stage: "pr_feedback",
    input: {
      feedbackStep: "apply",
      feedbackFixIds: fixes.map((item) => item.id),
      feedbackDecidedIds: codingRepository
        .listFeedback(run.id)
        .filter((item) => DECIDED.includes(item.status))
        .map((item) => item.id),
    } satisfies StageInput,
  });
  return { applying: true, fixes: fixes.length };
}

/** Push the fixes (if any) and post every drafted reply to GitHub. */
export async function publishFeedback(runId: string) {
  const run = requireRun(runId);
  assertOpen(run);
  if (!run.prNumber) throw conflict("This run has no pull request.");
  const repository = codingRepository.getRepository(run.repositoryId)!;
  const stage = codingRepository.currentStage(run.id, "pr_feedback");
  // Fixes exist only after the apply step finished. Before that ("Post replies only"
  // during triage), push nothing and leave the accepted fixes for the apply step.
  const fixesApplied =
    stage?.status === "waiting_approval" && (stage.input as StageInput).feedbackStep === "apply";
  const items = codingRepository
    .listFeedback(run.id)
    .filter((item) => item.status === "triaged" && (fixesApplied || item.action !== "fix"));
  const fixes = items.filter((item) => item.action === "fix");
  let pushed = null;
  if (fixes.length) {
    pushed = (
      await publishRun(run, {
        commitMessage: `[${run.issueKey}] Address review feedback`,
        openPullRequest: false,
      })
    ).result;
  }
  let replies = 0;
  for (const item of items) {
    if (item.reply?.trim() && (item.action === "reply" || item.action === "fix")) {
      await replyToFeedback(repository, run.prNumber, {
        reviewCommentId: item.kind === "review_comment" ? item.reviewCommentId : null,
        body: item.kind === "review_comment" ? item.reply : `@${item.author} ${item.reply}`,
      });
      replies += 1;
    }
    codingRepository.updateFeedback(item.id, {
      status: item.action === "fix" ? "fixed" : item.action === "reply" ? "replied" : "no_action",
      decidedAt: now(),
    });
  }
  const pendingFixes = codingRepository
    .listFeedback(run.id)
    .some((item) => item.status === "triaged" && item.action === "fix");
  if (stage && stage.status === "waiting_approval" && !pendingFixes) {
    codingRepository.updateStage(stage.id, { status: "done", finishedAt: now() });
  }
  return { pushed, replies };
}

// ---------------------------------------------------------------------------
// Read models

function summarizeRun(run: CodeRun): CodeRunSummary {
  const repository = codingRepository.getRepository(run.repositoryId);
  const stages = codingRepository.listStages(run.id).filter((stage) => !stage.superseded);
  const usage = codingRepository.stageUsage(stages.map(({ id }) => id));
  const stageSummaries = stages.map((stage) => ({
    id: stage.id,
    stage: stage.stage,
    status: stage.status,
    attempt: stage.attempt,
    ...(usage.get(stage.id) ?? {
      costUsd: null,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: null,
      model: null,
      runs: 0,
    }),
  }));
  const allUsage = codingRepository.stageUsage(
    codingRepository.listStages(run.id).map(({ id }) => id),
  );
  const costs = [...allUsage.values()].map((item) => item.costUsd).filter((value): value is number => value !== null);
  return {
    ...run,
    repository: repository
      ? { id: repository.id, owner: repository.owner, name: repository.name, fullName: repository.fullName }
      : { id: run.repositoryId, owner: "?", name: "?", fullName: "(deleted repository)" },
    stages: stageSummaries,
    costUsd: costs.length ? costs.reduce((sum, value) => sum + value, 0) : null,
  };
}

export function listCodingRuns() {
  return codingRepository.listRuns().map(summarizeRun);
}

export function listCodingRunsForIssue(issueKey: string) {
  return codingRepository.listRunsForIssue(issueKey.toUpperCase()).map(summarizeRun);
}

export type CodeStageDetail = CodeRunStage & {
  agentName: string | null;
  usage: CodeRunSummary["stages"][number] | null;
  runStatus: string | null;
  pendingApprovals: number;
};

export function getCodingRunDetail(id: string) {
  const run = codingRepository.getRun(id);
  if (!run) return null;
  const summary = summarizeRun(run);
  const stages = codingRepository.listStages(run.id);
  const usage = codingRepository.stageUsage(stages.map(({ id: stageId }) => stageId));
  const stageDetails: CodeStageDetail[] = stages.map((stage) => {
    const agentRun = stage.lastRunId ? runRepository.getRun(stage.lastRunId) : null;
    return {
      ...stage,
      agentName: stage.agentId ? (agentRepository.getAgent(stage.agentId)?.name ?? null) : null,
      usage: usage.has(stage.id)
        ? {
            id: stage.id,
            stage: stage.stage,
            status: stage.status,
            attempt: stage.attempt,
            ...usage.get(stage.id)!,
          }
        : null,
      runStatus: agentRun?.status ?? null,
      pendingApprovals: agentRun
        ? approvalRepository.listForRun(agentRun.id).filter((item) => item.status === "pending").length
        : 0,
    };
  });
  return {
    run: summary,
    repository: codingRepository.getRepository(run.repositoryId),
    stages: stageDetails,
    artifacts: codingRepository.listArtifacts(run.id).map((artifact) => ({
      id: artifact.id,
      stage: artifact.stage,
      attempt: artifact.attempt,
      name: artifact.name,
      createdAt: artifact.createdAt,
      size: artifact.content.length,
    })),
    feedback: codingRepository.listFeedback(run.id),
  };
}

export type CodingRunDetail = NonNullable<ReturnType<typeof getCodingRunDetail>>;

export function getArtifact(runId: string, artifactId: string) {
  const run = requireRun(runId);
  const artifact = codingRepository
    .listArtifacts(run.id)
    .find((item) => item.id === artifactId);
  if (!artifact) throw notFound("File not found.");
  return artifact;
}

export async function getRunDiff(runId: string) {
  const run = requireRun(runId);
  if (run.workspaceStatus !== "ready") throw conflict("The workspace is not available.");
  return codeRunner.diff(run.workspaceId);
}

export function getStageConversation(runId: string, stageId: string) {
  const run = requireRun(runId);
  const stage = requireStage(run, stageId);
  if (!stage.threadId) return { messages: [], runId: stage.lastRunId };
  return {
    messages: conversationRepository.listMessages(stage.threadId),
    runId: stage.lastRunId,
  };
}
