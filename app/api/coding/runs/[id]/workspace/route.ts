import { apiError } from "@/lib/api";
import { deleteCodingWorkspace } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ data: await deleteCodingWorkspace(id) });
  } catch (error) {
    return apiError(error, "Could not delete the workspace.");
  }
}
