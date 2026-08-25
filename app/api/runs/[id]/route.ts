import { repository } from "@/lib/repository";
import { approvalStore } from "@/lib/repositories/approval-store";
import { buildRunContextProfile } from "@/lib/run-context-profile";
import { apiError, notFound } from "@/lib/api";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
) {
  const { id } = await ctx.params;
  const run = repository.getRun(id);
  if (!run) return apiError(notFound("Run not found"));
  const events = repository.listRunEvents(id);
  return Response.json({
    data: {
      run,
      events,
      approvals: approvalStore.listForRun(id),
      contextProfile: buildRunContextProfile(run, events),
    },
  });
}
