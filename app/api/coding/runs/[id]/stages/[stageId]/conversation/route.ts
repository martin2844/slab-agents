import { apiError } from "@/lib/api";
import { getStageConversation } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const { id, stageId } = await context.params;
    return Response.json({ data: getStageConversation(id, stageId) });
  } catch (error) {
    return apiError(error, "Could not read the conversation.");
  }
}
