import { apiError } from "@/lib/api";
import { retryRun } from "@/lib/run-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/runs/[id]/retry">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await retryRun(id) }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not retry the run.");
  }
}
