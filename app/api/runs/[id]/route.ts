import { repository } from "@/lib/repository";
import { buildRunContextProfile } from "@/lib/run-context-profile";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
) {
  const { id } = await ctx.params;
  const run = repository.getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const events = repository.listRunEvents(id);
  return Response.json({
    data: {
      run,
      events,
      approvals: repository.listApprovals().filter((a) => a.runId === id),
      contextProfile: buildRunContextProfile(run, events),
    },
  });
}
