import { apiError } from "@/lib/api";
import { applyFeedback } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ data: applyFeedback(id) });
  } catch (error) {
    return apiError(error, "Could not apply the feedback decisions.");
  }
}
