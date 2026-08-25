import "server-only";

import { conflict, notFound } from "@/lib/api";
import { approvalStore } from "@/lib/repositories/approval-store";
import { repository } from "@/lib/repository";
import { resolveRunnerApproval } from "@/lib/runner";
import { isRunnerRunNotFound } from "@/lib/runner-errors";

type Decision = "approve" | "deny";

type Dependencies = {
  resolveRunner: typeof resolveRunnerApproval;
  runnerRunNotFound: typeof isRunnerRunNotFound;
  finalizeLocal?: typeof finalizeLocalApproval;
  recordRunnerDecision?: typeof approvalStore.recordRunnerDecision;
};

const defaultDependencies: Dependencies = {
  resolveRunner: resolveRunnerApproval,
  runnerRunNotFound: isRunnerRunNotFound,
};

function finalizeLocalApproval(
  approval: NonNullable<ReturnType<typeof approvalStore.get>>,
  decision: Decision,
) {
  return repository.transaction(() => {
    const result = approvalStore.resolve(
      approval.id,
      decision === "approve" ? "approved" : "denied",
    );
    if (!result) throw new Error("Could not finalize approval resolution");
    repository.addRunEvent(
      approval.runId,
      decision === "approve" ? "approval_approved" : "approval_denied",
      { approvalId: approval.id },
    );
    approvalStore.resumeRunWhenClear(approval.runId);
    return result;
  });
}

export async function resolveApprovalAction(
  id: string,
  decision: Decision,
  dependencies: Dependencies = defaultDependencies,
) {
  const approval = approvalStore.claim(id);
  if (!approval) {
    const current = approvalStore.get(id);
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

  const run = repository.getRun(claimed.runId);
  if (
    run &&
    ["completed", "failed", "cancelled", "skipped"].includes(run.status)
  ) {
    try {
      return repository.transaction(() => {
        const result = approvalStore.resolve(id, "denied");
        if (!result) throw new Error("Could not dismiss stale approval");
        approvalStore.closeOpen(claimed.runId);
        repository.addRunEvent(claimed.runId, "approval_dismissed", {
          approvalId: id,
          reason: "run_already_terminal",
        });
        return { ...result, dismissed: true as const };
      });
    } catch (error) {
      approvalStore.release(id);
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
      dependencies.recordRunnerDecision ?? approvalStore.recordRunnerDecision;
    if (!recordRunnerDecision(id, decision)) {
      throw new Error("Could not record Runner approval resolution");
    }
    const recorded = approvalStore.get(id) ?? claimed;
    return (dependencies.finalizeLocal ?? finalizeLocalApproval)(
      recorded,
      decision,
    );
  } catch (error) {
    if (dependencies.runnerRunNotFound(error)) {
      return repository.transaction(() => {
        const result = approvalStore.resolve(id, "denied");
        if (!result) throw new Error("Could not dismiss stale approval");
        approvalStore.closeOpen(claimed.runId);
        repository.addRunEvent(claimed.runId, "approval_dismissed", {
          approvalId: id,
          reason: "runner_run_not_found",
        });
        approvalStore.cancelRunIfActive(
          claimed.runId,
          "Runner run was not found; stale approval dismissed.",
        );
        return { ...result, dismissed: true as const };
      });
    }
    if (
      !runnerAccepted &&
      approvalStore.get(id)?.details.runnerDecision !== decision
    ) {
      approvalStore.release(id);
    }
    throw error;
  }
}
