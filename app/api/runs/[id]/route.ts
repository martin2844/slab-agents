import { runRepository } from "@/lib/repositories/run-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { buildRunContextProfile } from "@/lib/run-context-profile";
import { apiError, notFound } from "@/lib/api";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
) {
  const { id } = await ctx.params;
  const run = runRepository.getRun(id);
  if (!run) return apiError(notFound("Run not found"));
  const events = runRepository.listRunEvents(id);
  return Response.json({
    data: {
      run,
      events,
      approvals: approvalRepository.listForRun(id),
      contextProfile: buildRunContextProfile(run, events),
    },
  });
}
