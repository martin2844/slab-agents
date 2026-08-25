import "server-only";

import { runRepository } from "@/lib/repositories/run-repository";
import { withImmediateTransaction } from "@/lib/db/transaction";

import { conflict, notFound } from "@/lib/api";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { resolveRunnerApproval } from "@/lib/runner";
import { isRunnerRunNotFound } from "@/lib/runner-errors";

type Decision = "approve" | "deny";

type Dependencies = {
  resolveRunner: typeof resolveRunnerApproval;
  runnerRunNotFound: typeof isRunnerRunNotFound;
  finalizeLocal?: typeof finalizeLocalApproval;
  recordRunnerDecision?: typeof approvalRepository.recordRunnerDecision;
};

const defaultDependencies: Dependencies = {
  resolveRunner: resolveRunnerApproval,
  runnerRunNotFound: isRunnerRunNotFound,
};

function finalizeLocalApproval(
  approval: NonNullable<ReturnType<typeof approvalRepository.get>>,
  decision: Decision,
) {
  return withImmediateTransaction(() => {
    const result = approvalRepository.resolve(
      approval.id,
      decision === "approve" ? "approved" : "denied",
    );
    if (!result) throw new Error("Could not finalize approval resolution");
    runRepository.addRunEvent(
      approval.runId,
      decision === "approve" ? "approval_approved" : "approval_denied",
      { approvalId: approval.id },
    );
    runRepository.resumeWhenApprovalsClear(approval.runId);
    return result;
  });
}

export async function resolveApprovalAction(
  id: string,
  decision: Decision,
  dependencies: Dependencies = defaultDependencies,
) {
  const approval = approvalRepository.claim(id);
  if (!approval) {
    const current = approvalRepository.get(id);
    if (
      current?.status === "resolving" &&
      current.details.runnerDecision === decision
    ) {
      return (dependencies.finalizeLocal ?? finalizeLocalApproval)(
        current,
        decision,
      );
    }
    throw current
      ? conflict(
          "Approval is already being resolved or has been resolved",
          "APPROVAL_ALREADY_RESOLVED",
        )
      : notFound("Approval not found");
  }
  const claimed = approval;

  const run = runRepository.getRun(claimed.runId);
  if (
    run &&
    ["completed", "failed", "cancelled", "skipped"].includes(run.status)
  ) {
    try {
      return withImmediateTransaction(() => {
        const result = approvalRepository.resolve(id, "denied");
        if (!result) throw new Error("Could not dismiss stale approval");
        approvalRepository.closeOpen(claimed.runId);
        runRepository.addRunEvent(claimed.runId, "approval_dismissed", {
          approvalId: id,
          reason: "run_already_terminal",
        });
        return { ...result, dismissed: true as const };
      });
    } catch (error) {
      approvalRepository.release(id);
      throw error;
    }
  }

  let runnerAccepted = false;
  try {
    await dependencies.resolveRunner(
      typeof claimed.details.runnerRunId === "string"
        ? claimed.details.runnerRunId
        : claimed.runId,
      claimed.runnerApprovalId,
      decision,
    );
    runnerAccepted = true;
    const recordRunnerDecision =
      dependencies.recordRunnerDecision ??
      approvalRepository.recordRunnerDecision;
    if (!recordRunnerDecision(id, decision)) {
      throw new Error("Could not record Runner approval resolution");
    }
    const recorded = approvalRepository.get(id) ?? claimed;
    return (dependencies.finalizeLocal ?? finalizeLocalApproval)(
      recorded,
      decision,
    );
  } catch (error) {
    if (dependencies.runnerRunNotFound(error)) {
      return withImmediateTransaction(() => {
        const result = approvalRepository.resolve(id, "denied");
        if (!result) throw new Error("Could not dismiss stale approval");
        approvalRepository.closeOpen(claimed.runId);
        runRepository.addRunEvent(claimed.runId, "approval_dismissed", {
          approvalId: id,
          reason: "runner_run_not_found",
        });
        runRepository.cancelIfActive(
          claimed.runId,
          "Runner run was not found; stale approval dismissed.",
        );
        return { ...result, dismissed: true as const };
      });
    }
    if (
      !runnerAccepted &&
      approvalRepository.get(id)?.details.runnerDecision !== decision
    ) {
      approvalRepository.release(id);
    }
    throw error;
  }
}
