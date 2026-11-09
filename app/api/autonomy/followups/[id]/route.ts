import { apiError } from "@/lib/api";
import { cancelFollowup } from "@/lib/autonomy/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    cancelFollowup(id, "operator");
    return Response.json({ data: { cancelled: true } });
  } catch (error) {
    return apiError(error, "Could not cancel the follow-up.");
  }
}
