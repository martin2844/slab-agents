import { apiError } from "@/lib/api";
import { isRuntimeId } from "@/lib/runtime-config";
import { testRuntime } from "@/lib/runtime-service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/runtimes/[id]/test">,
) {
  try {
    const { id } = await context.params;
    if (!isRuntimeId(id)) {
      return Response.json({ error: "Runtime not found" }, { status: 404 });
    }
    return Response.json({ data: await testRuntime(id) });
  } catch (error) {
    return apiError(error);
  }
}
