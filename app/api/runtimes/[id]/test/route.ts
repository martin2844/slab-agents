import { apiError, notFound } from "@/lib/api";
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
      throw notFound("Runtime not found");
    }
    return Response.json({ data: await testRuntime(id) });
  } catch (error) {
    return apiError(error);
  }
}
