import "server-only";

import { codingRepository } from "@/lib/repositories/coding-repository";
import { codeRunner, CodeRunnerError, type CodeWorkspace } from "@/lib/coding/code-runner";
import {
  appIdentity,
  createDraftPullRequest,
  getCiState,
  getPullRequest,
  installationToken,
  repositoryCloneUrl,
  updatePullRequest,
} from "@/lib/coding/github";
import {
  markdownSection,
  parseHandoff,
  reviewFeedback,
  stageOutcome,
  summarize,
} from "@/lib/coding/handoff";
import {
  buildContinuationMessage,
  buildStageMessage,
} from "@/lib/coding/stage-message";
import {
  nextPipelineStage,
  STAGE_DEFINITIONS,
  type AgentStage,
  type CodingStage,
} from "@/lib/coding/stages";
import type { CodeRepository, CodeRun, CodeRunStage } from "@/lib/coding/types";
import { agentForStage } from "@/lib/coding/agents";
import {
  syncPullRequestMerged,
  syncPullRequestOpened,
  workItemContext,
} from "@/lib/coding/work-sync";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { createRunExecution, executeRunInBackground } from "@/lib/run-service";
import { cancelRunnerRun } from "@/lib/runner";

const now = () => new Date().toISOString();

const TICK_MS = 3_000;
const PR_POLL_MS = 120_000;
/** Times the plan reviewer may send a plan back to the Tech Lead automatically. */
const PLAN_REVIEW_LOOPS = 2;

const state = globalThis as unknown as {
  slabCodingTimer?: NodeJS.Timeout;
  slabCodingBusy?: boolean;
  slabCodingInflight?: Set<string>;
};
const inflight = (state.slabCodingInflight ??= new Set<string>());

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Runs one async operation per key at a time; later calls are ignored while it runs. */
function once(key: string, task: () => Promise<void>) {
  if (inflight.has(key)) return;
  inflight.add(key);
  void task()
    .catch((error) => console.error(`[coding] ${key} failed`, error))
    .finally(() => inflight.delete(key));
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "skipped", "cancelled"]);

export function workspaceForRun(run: CodeRun) {
  return codeRunner.getWorkspace(run.workspaceId);
}

// ---------------------------------------------------------------------------
// Workspace preparation

async function prepareWorkspace(run: CodeRun, repository: CodeRepository) {
  codingRepository.updateRun(run.id, { workspaceStatus: "preparing", error: null });
  const token = await installationToken(repository, "fetch");
  await codeRunner.createWorkspace({
    workspaceId: run.workspaceId,
    repository: {
      cloneUrl: repositoryCloneUrl(repository),
      defaultBranch: repository.defaultBranch,
    },
    baseRef: repository.defaultBranch,
    branch: run.branch,
    fetchToken: token,
    setupCommand: repository.setupCommand,
    setupTimeoutSeconds: 1800,
    gitIdentity: await appIdentity(repository),
  });
}

async function writeRunBrief(run: CodeRun, repository: CodeRepository) {
  const lines = [
    "---",
    `run: ${run.number}`,
    `work_item: ${run.issueKey}`,
    `repository: ${repository.fullName}`,
    `branch: ${run.branch}`,
    "---",
    `# ${run.issueKey} — ${run.title}`,
    "",
  ];
  try {
    const { issue, comments } = await workItemContext(run.issueKey);
    lines.push(
      `- Type: ${issue.type} · Priority: ${issue.priority} · Status: ${issue.status}`,
      ...(issue.labels?.length ? [`- Labels: ${issue.labels.join(", ")}`] : []),
      ...(issue.assignee ? [`- Assignee: ${issue.assignee}`] : []),
      "",
      "## Description",
      issue.description?.trim() || "(no description)",
      "",
      "## Comments",
      ...(comments.length
        ? comments.map((comment) => `- ${comment.author} (${comment.created_at}): ${comment.body}`)
        : ["(none)"]),
    );
  } catch (error) {
    lines.push(`(Slab could not read the Work item: ${errorMessage(error)}. Read it with the Work tools.)`);
  }
  if (run.note.trim()) lines.push("", "## Note from the user", run.note.trim());
  await codeRunner.writeHandoff(run.workspaceId, "run.md", `${lines.join("\n")}\n`);
  codingRepository.saveArtifact({
    codeRunId: run.id,
    stage: "pm",
    attempt: 0,
    name: "run.md",
    content: `${lines.join("\n")}\n`,
  });
}

/** True while the run is still being prepared (not cancelled or failed meanwhile). */
function stillPreparing(runId: string) {
  const latest = codingRepository.getRun(runId);
  return Boolean(latest && latest.status === "preparing");
}

async function reconcileWorkspace(run: CodeRun, repository: CodeRepository) {
  if (run.workspaceStatus === "pending") {
    once(`workspace:${run.id}`, async () => {
      try {
        await prepareWorkspace(run, repository);
      } catch (error) {
        if (!stillPreparing(run.id)) return;
        codingRepository.updateRun(run.id, {
          workspaceStatus: "failed",
          status: "failed",
          error: `Could not prepare the workspace: ${errorMessage(error)}`,
          finishedAt: now(),
        });
      }
    });
    return false;
  }
  if (run.workspaceStatus === "preparing") {
    once(`workspace:${run.id}`, async () => {
      let workspace: CodeWorkspace;
      try {
        workspace = await codeRunner.getWorkspace(run.workspaceId);
      } catch (error) {
        if (error instanceof CodeRunnerError && error.status === 404) {
          codingRepository.updateRun(run.id, { workspaceStatus: "pending" });
        }
        return;
      }
      if (!stillPreparing(run.id)) return;
      if (workspace.status === "failed") {
        codingRepository.updateRun(run.id, {
          workspaceStatus: "failed",
          status: "failed",
          error: `The workspace failed: ${workspace.error ?? "unknown error"}`,
          finishedAt: now(),
        });
        return;
      }
      if (workspace.status === "preparing") return;
      await writeRunBrief(run, repository);
      if (!stillPreparing(run.id)) return;
      codingRepository.updateRun(run.id, {
        workspaceStatus: "ready",
        baseSha: workspace.baseSha,
        headSha: workspace.headSha,
        status: "active",
      });
    });
    return false;
  }
  return run.workspaceStatus === "ready";
}

// ---------------------------------------------------------------------------
// Launching stage runs

function stageAgentKey(stage: CodingStage): AgentStage | null {
  return stage === "publish" ? null : stage;
}

async function availableHandoff(run: CodeRun) {
  try {
    return (await codeRunner.listHandoff(run.workspaceId)).map(({ name }) => name);
  } catch {
    return [];
  }
}

export type StageInput = {
  feedbackStep?: "triage" | "apply";
  feedbackFixIds?: string[];
  feedbackDecidedIds?: string[];
  /** Reason for an automatic retry; consumed by the next launch. */
  retryReason?: string;
  /** Message from the user; consumed by the next launch. */
  pendingMessage?: string;
  /** Automatic plan-review loops that produced this tech spec attempt. */
  planReviewLoops?: number;
};

/** Queues a stage launch. The orchestrator tick starts it when the workspace is free. */
export function queueStage(
  stage: CodeRunStage,
  patch: Pick<StageInput, "retryReason" | "pendingMessage"> & { autoRetries?: number } = {},
) {
  const input = { ...(stage.input as StageInput) };
  if (patch.retryReason !== undefined) input.retryReason = patch.retryReason;
  if (patch.pendingMessage !== undefined) input.pendingMessage = patch.pendingMessage;
  return codingRepository.updateStage(stage.id, {
    status: "queued",
    input,
    ...(patch.autoRetries !== undefined ? { autoRetries: patch.autoRetries } : {}),
  });
}

/** Starts (or continues) one agent stage as a Slab run on the code runner. */
export async function launchStage(run: CodeRun, stage: CodeRunStage) {
  const repository = codingRepository.getRepository(run.repositoryId);
  if (!repository) throw new Error("The coding run repository no longer exists.");
  const agentStage = stageAgentKey(stage.stage);
  if (!agentStage) throw new Error("This stage has no agent.");
  const agent = agentForStage(agentStage);
  if (!agent || !agent.enabled) {
    codingRepository.updateStage(stage.id, {
      status: "failed",
      summary: `No enabled agent is assigned to the ${STAGE_DEFINITIONS[stage.stage].name} stage. Assign one in Coding settings.`,
      finishedAt: now(),
    });
    return null;
  }
  const workspace = await codeRunner.getWorkspace(run.workspaceId);
  const continuing = Boolean(stage.threadId && stage.lastRunId);
  let threadId = stage.threadId;
  if (!threadId || conversationRepository.getThread(threadId)?.agentId !== agent.id) {
    threadId = conversationRepository.createThread(
      agent.id,
      `Coding #${run.number} · ${STAGE_DEFINITIONS[stage.stage].name} · ${run.issueKey}`,
    ).id;
  }
  const input = stage.input as StageInput;
  const options = {
    retryReason: input.retryReason ?? null,
    userMessage: input.pendingMessage ?? null,
  };
  const definition = STAGE_DEFINITIONS[stage.stage];
  const prompt =
    continuing && threadId === stage.threadId && stage.stage !== "pr_feedback"
      ? buildContinuationMessage({
          stage: stage.stage,
          output: definition.output,
          userMessage: options.userMessage,
          retryReason: options.retryReason,
        })
      : buildStageMessage({
          number: run.number,
          issueKey: run.issueKey,
          title: run.title,
          stage: stage.stage,
          attempt: stage.attempt,
          repository,
          branch: run.branch,
          baseSha: run.baseSha ?? workspace.baseSha,
          repoPath: workspace.repoPath,
          handoffPath: workspace.handoffPath,
          availableInputs: await availableHandoff(run),
          prUrl: run.prUrl,
          prState: run.prState,
          retryReason: options.retryReason,
          userMessage: options.userMessage,
          feedbackStep: input.feedbackStep ?? null,
          feedbackFixIds: input.feedbackFixIds,
          feedbackDecidedIds: input.feedbackDecidedIds,
        });
  // The user may have stopped, re-run or cancelled while this launch waited on the
  // code runner. Nothing below awaits, so this check and the launch are atomic.
  const latestStage = codingRepository.getStage(stage.id);
  const latestRun = codingRepository.getRun(run.id);
  if (
    !latestStage ||
    latestStage.superseded ||
    latestStage.status !== "queued" ||
    !latestRun ||
    latestRun.status === "cancelled"
  ) {
    return null;
  }
  const agentRun = createRunExecution({
    agentId: agent.id,
    threadId,
    trigger: "coding",
    mode: "code_stage",
    prompt: prompt || "Continue.",
    issueKey: run.issueKey,
  });
  codingRepository.linkRunToStage(agentRun.id, stage.id);
  const { retryReason: _retry, pendingMessage: _pending, ...remainingInput } = input;
  void _retry;
  void _pending;
  codingRepository.updateStage(stage.id, {
    status: "running",
    input: remainingInput,
    agentId: agent.id,
    threadId,
    lastRunId: agentRun.id,
    startedAt: stage.startedAt ?? now(),
    finishedAt: null,
  });
  void executeRunInBackground(agentRun.id).catch((error) =>
    console.error("[coding] stage run failed to execute", error),
  );
  return agentRun;
}

/** Stopped or replaced stages whose agent run has not really ended yet. */
function staleLiveStages(codeRunId: string) {
  return codingRepository.listStages(codeRunId).filter((stage) => {
    if (!stage.lastRunId || (stage.status !== "cancelled" && !stage.superseded)) return false;
    if (!stage.superseded && stage.status === "running") return false;
    const agentRun = runRepository.getRun(stage.lastRunId);
    return Boolean(agentRun && !TERMINAL_RUN_STATUSES.has(agentRun.status));
  });
}

function workspaceBusy(codeRunId: string) {
  if (inflight.has(`launching:${codeRunId}`)) return true;
  if (
    codingRepository
      .listStages(codeRunId)
      .some((stage) => !stage.superseded && stage.status === "running")
  ) {
    return true;
  }
  // A stopped or replaced stage holds the workspace until its agent run really ends.
  return staleLiveStages(codeRunId).length > 0;
}

/** Launches one stage; at most one launch per coding run is in flight. */
function launch(run: CodeRun, stage: CodeRunStage) {
  once(`launching:${run.id}`, async () => {
    try {
      await launchStage(run, stage);
    } catch (error) {
      const latest = codingRepository.getStage(stage.id);
      if (!latest || latest.superseded || latest.status !== "queued") return;
      failOrRetry(run, latest, `Could not start the stage: ${errorMessage(error)}`);
    }
  });
}

const lastReap = new Map<string, number>();

/** Re-sends cancellation for stopped stages whose run is still alive (a lost or early cancel). */
function reapStaleStages(run: CodeRun) {
  for (const stage of staleLiveStages(run.id)) {
    const last = lastReap.get(stage.id) ?? 0;
    if (Date.now() - last < 30_000) continue;
    lastReap.set(stage.id, Date.now());
    once(`reap:${stage.id}`, () => stopStageRun(stage));
  }
}

// ---------------------------------------------------------------------------
// Evaluating finished stage runs

async function saveHandoffArtifacts(run: CodeRun, stage: CodeRunStage, names: string[]) {
  const contents = new Map<string, string | null>();
  for (const name of names) {
    const file = await codeRunner.readHandoff(run.workspaceId, name).catch(() => null);
    contents.set(name, file?.content ?? null);
    if (file?.content) {
      codingRepository.saveArtifact({
        codeRunId: run.id,
        stage: stage.stage,
        attempt: stage.attempt,
        name,
        content: file.content,
      });
    }
  }
  return contents;
}

function stillRunning(stageId: string) {
  const latest = codingRepository.getStage(stageId);
  return Boolean(latest && !latest.superseded && latest.status === "running");
}

function waitFor(stage: CodeRunStage, status: "needs_input" | "waiting_approval", patch: Partial<CodeRunStage> = {}) {
  codingRepository.updateStage(stage.id, { ...patch, status });
}

function failOrRetry(run: CodeRun, stage: CodeRunStage, reason: string) {
  const definition = STAGE_DEFINITIONS[stage.stage];
  void run;
  if (stage.autoRetries < definition.autoRetries) {
    queueStage(stage, { retryReason: reason, autoRetries: stage.autoRetries + 1 });
    return;
  }
  codingRepository.updateStage(stage.id, {
    status: "failed",
    summary: reason,
    finishedAt: now(),
  });
}

function completeStage(stage: CodeRunStage, patch: Partial<CodeRunStage> = {}) {
  return codingRepository.updateStage(stage.id, {
    ...patch,
    status: "done",
    finishedAt: now(),
  });
}

async function applyPullRequestBody(run: CodeRun, body: string) {
  if (!run.prNumber) return;
  const repository = codingRepository.getRepository(run.repositoryId);
  if (!repository) return;
  const footer = `\n\n---\nWork item: ${run.issueKey} · Slab coding run #${run.number}`;
  await updatePullRequest(repository, run.prNumber, {
    body: `${body.trim()}${body.includes(`Slab coding run #${run.number}`) ? "" : footer}`,
  });
}

async function evaluateStage(run: CodeRun, stage: CodeRunStage) {
  const agentRun = stage.lastRunId ? runRepository.getRun(stage.lastRunId) : null;
  if (!agentRun) return;
  if (agentRun.status === "waiting_approval") return;
  if (!TERMINAL_RUN_STATUSES.has(agentRun.status)) return;
  const fresh = codingRepository.getStage(stage.id)!;
  if (fresh.status !== "running") return;

  if (agentRun.status === "cancelled") {
    codingRepository.updateStage(stage.id, {
      status: "cancelled",
      summary: "The stage run was stopped.",
      finishedAt: now(),
    });
    return;
  }
  if (agentRun.status === "failed" || agentRun.status === "skipped") {
    failOrRetry(run, fresh, `The stage run failed: ${agentRun.error ?? "unknown error"}`);
    return;
  }

  // Chat: no output contract. The conversation is the result.
  if (stage.stage === "chat") {
    completeStage(fresh, {
      summary: summarize(conversationRepository.getRunAssistantOutput(agentRun.id)?.body ?? ""),
    });
    return;
  }

  if (stage.stage === "pr_feedback") {
    await evaluateFeedbackStage(run, fresh);
    return;
  }

  const definition = STAGE_DEFINITIONS[stage.stage];
  const outputs = stage.stage === "final_pass" ? ["final.md", "pr-body.md"] : [definition.output!];
  const contents = await saveHandoffArtifacts(run, fresh, outputs);
  // A stop or re-run during the read wins over this result.
  if (!stillRunning(fresh.id)) return;
  const content = contents.get(definition.output!) ?? null;
  const outcome = stageOutcome(content);
  if (outcome.kind === "missing") {
    failOrRetry(run, fresh, outcome.reason);
    return;
  }
  if (outcome.kind === "needs_input") {
    waitFor(fresh, "needs_input", {
      questions: outcome.questions,
      summary: outcome.summary || "The agent needs your input.",
    });
    return;
  }
  const values = outcome.values;
  const summary = outcome.summary;
  switch (stage.stage) {
    case "pm":
      waitFor(fresh, "waiting_approval", { summary, questions: [], verdict: null });
      return;
    case "tech_spec":
      completeStage(fresh, { summary, questions: [] });
      return;
    case "plan_review": {
      const verdict = (values.verdict ?? "").toLowerCase();
      if (verdict === "pass") {
        completeStage(fresh, { summary, verdict: "pass", questions: [] });
        return;
      }
      // Automatic loops since the last user re-run or reply (counted on the tech spec attempt).
      const plan = codingRepository.currentStage(run.id, "tech_spec");
      const loops = Number((plan?.input as StageInput | undefined)?.planReviewLoops ?? 0);
      const planAttempts = loops + 1;
      if (loops < PLAN_REVIEW_LOOPS) {
        completeStage(fresh, { summary, verdict: "fail", questions: [] });
        // Send the plan back to the Tech Lead with the failed rubric items.
        codingRepository.supersedeStages(run.id, ["tech_spec"]);
        codingRepository.createStage({
          codeRunId: run.id,
          stage: "tech_spec",
          input: {
            retryReason: reviewFeedback(content ?? "") || "The plan review failed.",
            planReviewLoops: loops + 1,
          },
        });
        codingRepository.supersedeStages(run.id, ["plan_review"]);
        codingRepository.updateRun(run.id, { currentStage: "tech_spec" });
        return;
      }
      waitFor(fresh, "waiting_approval", {
        summary: `The plan failed the review ${planAttempts} times. ${summary}`,
        verdict: "fail",
      });
      return;
    }
    case "engineer": {
      const notes = markdownSection(content ?? "", "Repo setup notes");
      if (notes && notes !== "(none)") {
        codingRepository.setRepositorySetupNotes(run.repositoryId, notes);
      }
      const checks = (values.checks ?? "").toLowerCase();
      if (checks === "fail") {
        waitFor(fresh, "waiting_approval", {
          summary: `Checks failed. ${summary}`,
          verdict: "fail",
        });
        return;
      }
      completeStage(fresh, { summary, verdict: checks || null, questions: [] });
      return;
    }
    case "code_review":
      waitFor(fresh, "waiting_approval", {
        summary,
        verdict: (values.ready ?? "").toLowerCase() === "true" ? "ready" : "not_ready",
        questions: [],
      });
      return;
    case "final_pass": {
      const body = contents.get("pr-body.md");
      if (!body?.trim()) {
        failOrRetry(run, fresh, "pr-body.md is missing from the handoff folder.");
        return;
      }
      try {
        await applyPullRequestBody(run, parseHandoff(body).body || body);
      } catch (error) {
        waitFor(fresh, "waiting_approval", {
          summary: `Slab could not update the pull request description: ${errorMessage(error)}`,
        });
        return;
      }
      completeStage(fresh, { summary, questions: [] });
      return;
    }
    default:
      completeStage(fresh, { summary });
  }
}

async function evaluateFeedbackStage(run: CodeRun, stage: CodeRunStage) {
  const step = (stage.input as { feedbackStep?: string }).feedbackStep ?? "triage";
  const name = step === "apply" ? "feedback-result.json" : "feedback-triage.json";
  const contents = await saveHandoffArtifacts(run, stage, [name]);
  if (!stillRunning(stage.id)) return;
  const raw = contents.get(name);
  let parsed: { items?: Array<Record<string, unknown>> } | null = null;
  try {
    parsed = raw ? (JSON.parse(raw) as { items?: Array<Record<string, unknown>> }) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    failOrRetry(run, stage, `${name} is missing or is not valid JSON with an "items" array.`);
    return;
  }
  const items = new Map(codingRepository.listFeedback(run.id).map((item) => [item.id, item]));
  if (step === "apply") {
    let fixed = 0;
    const confirmed = new Set<string>();
    for (const result of parsed.items) {
      const item = items.get(String(result.id ?? ""));
      if (!item) continue;
      const note = typeof result.note === "string" ? result.note : null;
      if (result.status === "fixed") {
        fixed += 1;
        confirmed.add(item.id);
      }
      codingRepository.updateFeedback(item.id, {
        reason: [item.reason, note].filter(Boolean).join(" — "),
      });
    }
    // Accepted fixes the agent did not confirm become replies without the drafted
    // "fixed" text, so Slab never tells a reviewer something was fixed when it was not.
    const fixIds = new Set((stage.input as StageInput).feedbackFixIds ?? []);
    for (const item of codingRepository.listFeedback(run.id)) {
      if (item.status !== "triaged" || item.action !== "fix" || confirmed.has(item.id)) continue;
      if (fixIds.size && !fixIds.has(item.id)) continue;
      codingRepository.updateFeedback(item.id, {
        action: "reply",
        reply: null,
        reason: [item.reason, "Not fixed by the agent; write a reply or fix it in the run chat."]
          .filter(Boolean)
          .join(" — "),
      });
    }
    waitFor(stage, "waiting_approval", {
      summary: `${fixed} item(s) fixed. Publish the fixes and post the replies.`,
    });
    return;
  }
  let triaged = 0;
  for (const decision of parsed.items) {
    const item = items.get(String(decision.id ?? ""));
    if (!item || item.status !== "new") continue;
    const action = ["fix", "reply", "no_action"].includes(String(decision.action))
      ? (String(decision.action) as "fix" | "reply" | "no_action")
      : "no_action";
    codingRepository.updateFeedback(item.id, {
      status: "triaged",
      action,
      reason: typeof decision.reason === "string" ? decision.reason : null,
      reply: typeof decision.reply === "string" && decision.reply.trim() ? decision.reply : null,
      roundStageId: stage.id,
    });
    triaged += 1;
  }
  waitFor(stage, "waiting_approval", {
    summary: `${triaged} item(s) triaged. Review the decisions, then apply.`,
  });
}

// ---------------------------------------------------------------------------
// Publishing

export async function publishRun(
  run: CodeRun,
  options: { commitMessage: string; openPullRequest: boolean },
) {
  const repository = codingRepository.getRepository(run.repositoryId);
  if (!repository) throw new Error("The coding run repository no longer exists.");
  if (!run.baseSha) throw new Error("The workspace base commit is unknown; prepare the workspace again.");
  const token = await installationToken(repository, "push");
  const result = await codeRunner.publish(run.workspaceId, {
    pushToken: token,
    remoteUrl: repositoryCloneUrl(repository),
    branch: run.branch,
    baseSha: run.baseSha,
    commitMessage: options.commitMessage,
    forbiddenPaths: [".github/workflows/", ".gitmodules"],
  });
  let updated = codingRepository.updateRun(run.id, {
    headSha: result.headSha,
    lastPublishedSha: result.headSha,
    publishedAt: now(),
  });
  const latestRun = codingRepository.getRun(run.id);
  if (options.openPullRequest && !updated.prNumber && latestRun?.status !== "cancelled") {
    const review = codingRepository.latestArtifact(run.id, "code-review.md")?.content ?? "";
    const title =
      markdownSection(review, "PR title").split("\n")[0]?.trim() ||
      `[${run.issueKey}] ${run.title}`;
    const summary = markdownSection(review, "PR summary");
    const pull = await createDraftPullRequest(
      repository,
      {
        title,
        branch: run.branch,
        body: [
          summary || `Implements ${run.issueKey}: ${run.title}.`,
          "",
          "---",
          `Work item: ${run.issueKey} · Slab coding run #${run.number}`,
        ].join("\n"),
      },
      token,
    );
    updated = codingRepository.updateRun(run.id, {
      prNumber: pull.number,
      prUrl: pull.url,
      prState: pull.state,
      ciState: "pending",
    });
    void syncPullRequestOpened(updated, pull.url);
  }
  return { run: updated, result };
}

function runPublishStage(run: CodeRun, stage: CodeRunStage) {
  codingRepository.updateStage(stage.id, { status: "running", startedAt: now() });
  once(`publish:${stage.id}`, async () => {
    try {
      const { result, run: updated } = await publishRun(run, {
        commitMessage: `[${run.issueKey}] Apply review fixes`,
        openPullRequest: true,
      });
      if (!stillRunning(stage.id)) return;
      completeStage(stage, {
        summary: `Pushed ${result.commits} commit(s) to ${result.branch}${updated.prUrl ? ` · ${updated.prUrl}` : ""}.`,
      });
    } catch (error) {
      if (!stillRunning(stage.id)) return;
      const details =
        error instanceof CodeRunnerError && Array.isArray(error.details)
          ? ` Paths: ${(error.details as unknown[]).join(", ")}`
          : "";
      codingRepository.updateStage(stage.id, {
        status: "failed",
        summary: `${errorMessage(error)}${details}`,
        finishedAt: now(),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Pipeline progression

function startOrAdvance(run: CodeRun) {
  const current = codingRepository.currentStage(run.id, run.currentStage);
  if (!current) {
    codingRepository.createStage({ codeRunId: run.id, stage: run.currentStage });
    return;
  }
  if (
    current.status === "running" &&
    current.stage === "publish" &&
    !inflight.has(`publish:${current.id}`)
  ) {
    // The control plane restarted during a publish: publishing is idempotent
    // (force push of the run branch, existing PR is reused), so run it again.
    runPublishStage(run, current);
    return;
  }
  if (current.status === "queued") {
    if (current.stage === "publish") {
      runPublishStage(run, current);
      return;
    }
    if (workspaceBusy(run.id)) return;
    launch(run, current);
    return;
  }
  if (current.status === "done") {
    const next = nextPipelineStage(current.stage);
    if (!next) {
      if (run.status !== "done") {
        codingRepository.updateRun(run.id, { status: "done", finishedAt: now() });
      }
      return;
    }
    codingRepository.updateRun(run.id, { currentStage: next });
    if (!codingRepository.currentStage(run.id, next)) {
      codingRepository.createStage({ codeRunId: run.id, stage: next });
    }
  }
}

function startQueuedSideStages(run: CodeRun) {
  for (const stage of codingRepository.listStages(run.id)) {
    if (stage.superseded || stage.status !== "queued") continue;
    if (stage.stage !== "chat" && stage.stage !== "pr_feedback") continue;
    if (workspaceBusy(run.id)) return;
    launch(run, stage);
    return;
  }
}

function refreshRunStatus(run: CodeRun) {
  if (!["active", "waiting"].includes(run.status)) return;
  const stages = codingRepository.listStages(run.id).filter((stage) => !stage.superseded);
  const waitingOnUser = stages.some((stage) => {
    if (stage.stage === run.currentStage) {
      if (["needs_input", "waiting_approval", "failed", "cancelled"].includes(stage.status)) return true;
    } else if (["needs_input", "waiting_approval"].includes(stage.status)) {
      return true;
    }
    if (stage.status === "running" && stage.lastRunId) {
      return runRepository.getRun(stage.lastRunId)?.status === "waiting_approval";
    }
    return false;
  });
  const next = waitingOnUser ? "waiting" : "active";
  if (next !== run.status) codingRepository.updateRun(run.id, { status: next });
}

async function pollPullRequest(run: CodeRun) {
  if (!run.prNumber) return;
  if (run.prCheckedAt && Date.now() - Date.parse(run.prCheckedAt) < PR_POLL_MS) return;
  const repository = codingRepository.getRepository(run.repositoryId);
  if (!repository) return;
  codingRepository.updateRun(run.id, { prCheckedAt: now() });
  const { pull, token } = await getPullRequest(repository, run.prNumber);
  const ci = await getCiState(repository, pull.headSha, token).catch(() => null);
  const wasMerged = run.prState === "merged";
  const updated = codingRepository.updateRun(run.id, {
    prState: pull.state,
    prUrl: pull.url,
    ciState: ci?.state ?? run.ciState,
  });
  if (pull.state === "merged" && !wasMerged) void syncPullRequestMerged(updated);
}

export async function tickCoding() {
  if (state.slabCodingBusy) return;
  state.slabCodingBusy = true;
  try {
    for (const stage of codingRepository.activeStages()) {
      if (stage.status !== "running") continue;
      const run = codingRepository.getRun(stage.codeRunId);
      if (!run || run.status === "cancelled") continue;
      if (stage.stage === "publish") continue;
      try {
        await evaluateStage(run, stage);
      } catch (error) {
        console.error("[coding] stage evaluation failed", error);
      }
    }
    for (const run of codingRepository.listRunsWithQueuedSideStages()) {
      if (run.workspaceStatus === "ready") startQueuedSideStages(run);
    }
    for (const listed of codingRepository.listOpenRuns()) {
      const run = codingRepository.getRun(listed.id)!;
      const repository = codingRepository.getRepository(run.repositoryId);
      if (!repository) continue;
      try {
        reapStaleStages(run);
        if (!(await reconcileWorkspace(run, repository))) continue;
        startOrAdvance(codingRepository.getRun(run.id)!);
        startQueuedSideStages(codingRepository.getRun(run.id)!);
        refreshRunStatus(codingRepository.getRun(run.id)!);
      } catch (error) {
        console.error(`[coding] run #${run.number} tick failed`, error);
      }
    }
    for (const run of codingRepository.listRunsWithOpenPullRequests()) {
      once(`pr:${run.id}`, () => pollPullRequest(run));
    }
  } finally {
    state.slabCodingBusy = false;
  }
}

export function startCodingOrchestrator() {
  if (state.slabCodingTimer) return;
  state.slabCodingTimer = setInterval(() => {
    void tickCoding().catch((error) => console.error("[coding] tick failed", error));
  }, TICK_MS);
  state.slabCodingTimer.unref?.();
}

/** Stops the active run of a stage (best effort) without changing the pipeline. */
export async function stopStageRun(stage: CodeRunStage) {
  if (!stage.lastRunId) return;
  const agentRun = runRepository.getRun(stage.lastRunId);
  if (!agentRun || TERMINAL_RUN_STATUSES.has(agentRun.status)) return;
  if (agentRun.status === "queued" && !agentRun.runnerRunId) {
    runRepository.updateRun(agentRun.id, "cancelled", { error: "Stopped by the user." });
    return;
  }
  await cancelRunnerRun(agentRun.runnerRunId ?? agentRun.id).catch((error) =>
    console.error("[coding] cancel failed", error),
  );
}
