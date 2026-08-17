import { apiError } from "@/lib/api";
import { startAutomationRun } from "@/lib/run-service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/automations/[id]/run">,
) {
  try {
    const { id } = await ctx.params;
    const run = startAutomationRun(id, "manual");
    return Response.json({ data: run }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
