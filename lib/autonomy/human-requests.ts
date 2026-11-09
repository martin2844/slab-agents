import "server-only";

import { conflict, notFound } from "@/lib/api";
import { autonomyRepository, type HumanRequest } from "@/lib/repositories/autonomy-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { autonomyLimits, logAutonomyEvent } from "@/lib/autonomy/service";
import { startAutonomyRun } from "@/lib/autonomy/runs";

export type { HumanRequest };

export function getHumanRequest(id: string) {
  return autonomyRepository.getRequest(id);
}

export function listHumanRequests(input: { status?: HumanRequest["status"]; limit?: number } = {}) {
  return autonomyRepository.listRequests(input);
}

/** A question (the agent waits for the answer in a new run) or an update (information only). */
export function createHumanRequest(input: {
  kind: "question" | "update";
  runId: string | null;
  agentId: string | null;
  question: string;
  options?: string[];
  urgency?: HumanRequest["urgency"];
  defaultAnswer?: string | null;
  waitHours?: number | null;
}) {
  const run = input.runId ? runRepository.getRun(input.runId) : null;
  const limits = autonomyLimits();
  const waitHours = Math.min(720, Math.max(1, input.waitHours ?? limits.questionWaitHours));
  const request = autonomyRepository.createRequest({
    kind: input.kind,
    runId: input.runId,
    agentId: input.agentId,
    threadId: run?.threadId ?? null,
    issueKey: run?.issueKey ?? null,
    question: input.question.slice(0, 4_000),
    options: (input.options ?? []).slice(0, 8).map((option) => option.slice(0, 60)),
    urgency: input.urgency ?? "normal",
    status: input.kind === "question" ? "pending" : "sent",
    defaultAnswer: input.defaultAnswer?.slice(0, 2_000) ?? null,
    expiresAt: input.kind === "question" ? new Date(Date.now() + waitHours * 3_600_000).toISOString() : null,
  });
  const id = request.id;
  const agent = input.agentId ? agentRepository.getAgent(input.agentId) : null;
  logAutonomyEvent({
    kind: input.kind === "question" ? "question_asked" : "update_sent",
    actor: agent ? `agent:${agent.slug}` : "system",
    summary: `${agent?.name ?? "Slab"}: ${input.question.slice(0, 300)}`,
    payload: { requestId: id, runId: input.runId },
  });
  return getHumanRequest(id)!;
}

function continuationPrompt(request: HumanRequest, answer: string | null) {
  const run = request.runId ? runRepository.getRun(request.runId) : null;
  const original = request.runId ? conversationRepository.getRunInput(request.runId)?.body ?? "" : "";
  const output = request.runId ? conversationRepository.getRunAssistantOutput(request.runId)?.body ?? "" : "";
  return [
    answer === null
      ? `You asked the human a question and got no answer within the wait time. Continue with your best judgment, or stop and leave the work in a clear state.`
      : `The human answered your question. Continue the work with this answer.`,
    "",
    `Question: ${request.question}`,
    `Answer: ${answer ?? "(no answer)"}`,
    "",
    ...(original ? ["Original task of the run that asked:", original.slice(0, 6_000), ""] : []),
    ...(output ? ["What you wrote at the end of that run:", output.slice(0, 4_000), ""] : []),
    ...(run?.issueKey ? [`Work item: ${run.issueKey}`] : []),
  ].join("\n");
}

function continueRequest(request: HumanRequest, answer: string | null, actor: string): { runId: string | null; error: string | null } {
  if (!request.agentId) return { runId: null, error: "The question has no agent." };
  const run = request.runId ? runRepository.getRun(request.runId) : null;
  try {
    const continuation = startAutonomyRun({
      agentId: request.agentId,
      prompt: continuationPrompt(request, answer),
      mode: run?.issueKey ? "assignment" : run?.mode === "review" ? "review" : "task",
      issueKey: run?.issueKey ?? null,
      parentRunId: request.runId,
      origin: "question",
      title: `Answer: ${request.question.slice(0, 80)}`,
      actor,
    });
    autonomyRepository.setContinuation(request.id, continuation.id);
    return { runId: continuation.id, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAutonomyEvent({
      kind: "question_continuation_failed",
      actor: "system",
      summary: `Could not continue after the answer: ${message}`,
      payload: { requestId: request.id },
    });
    return { runId: null, error: message };
  }
}

/** Records the answer and starts the agent again with it. */
export function answerHumanRequest(id: string, answer: string, answeredBy: string) {
  const request = getHumanRequest(id);
  if (!request) throw notFound("Question not found.");
  if (request.kind !== "question") throw conflict("This message is not a question.");
  const text = answer.trim().slice(0, 4_000);
  if (!text) throw conflict("Write an answer.");
  const changed = autonomyRepository.closeRequest(id, { status: "answered", answer: text, answeredBy });
  if (!changed) throw conflict("This question was already answered or expired.");
  logAutonomyEvent({ kind: "question_answered", actor: answeredBy, summary: `Answered: ${request.question.slice(0, 200)}`, payload: { requestId: id } });
  const continuation = continueRequest(getHumanRequest(id)!, text, answeredBy);
  return { request: getHumanRequest(id)!, continuationRunId: continuation.runId, continuationError: continuation.error };
}

/** Questions past their wait time continue with the default answer, or without one. */
export function expireHumanRequests() {
  const due = autonomyRepository.listExpiredQuestions(new Date().toISOString());
  for (const request of due) {
    const changed = autonomyRepository.closeRequest(request.id, { status: "expired", answer: request.defaultAnswer, answeredBy: "timeout" });
    if (!changed) continue;
    logAutonomyEvent({ kind: "question_expired", actor: "system", summary: `No answer: ${request.question.slice(0, 200)}`, payload: { requestId: request.id } });
    continueRequest(getHumanRequest(request.id)!, request.defaultAnswer, "timeout");
  }
  return due.length;
}
