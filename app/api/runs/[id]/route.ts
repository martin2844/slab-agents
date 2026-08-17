import { repository } from "@/lib/repository";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]">,
) {
  const { id } = await ctx.params;
  const run = repository.getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({
    data: {
      run,
      events: repository.listRunEvents(id),
      approvals: repository.listApprovals().filter((a) => a.runId === id),
    },
  });
}
