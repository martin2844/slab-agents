import { z } from "zod";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";
import { resolveRunnerApproval } from "@/lib/runner";
const schema = z.object({ decision: z.enum(["approve", "deny"]) });
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/approvals/[id]">,
) {
  try {
    const { id } = await ctx.params,
      { decision } = schema.parse(await request.json());
    const approval = repository.claimApproval(id);
    if (!approval) {
      const existing = repository.getApproval(id);
      return Response.json(
        {
          error: existing
            ? "Approval is already being resolved or has been resolved"
            : "Approval not found",
        },
        { status: existing ? 409 : 404 },
      );
    }
    try {
      await resolveRunnerApproval(
        typeof approval.details.runnerRunId === "string"
          ? approval.details.runnerRunId
          : approval.runId,
        approval.runnerApprovalId,
        decision,
      );
      const result = repository.resolveApproval(
        id,
        decision === "approve" ? "approved" : "denied",
      );
      if (!result) throw new Error("Could not finalize approval resolution");
      repository.addRunEvent(
        approval.runId,
        decision === "approve" ? "approval_approved" : "approval_denied",
        { approvalId: id },
      );
      repository.updateRun(approval.runId, "running");
      return Response.json({ data: result });
    } catch (error) {
      repository.releaseApproval(id);
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
