import { apiError } from "@/lib/api";
import { stopStage } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const { id, stageId } = await context.params;
    return Response.json({ data: await stopStage(id, stageId) });
  } catch (error) {
    return apiError(error, "Could not stop the stage.");
  }
}
