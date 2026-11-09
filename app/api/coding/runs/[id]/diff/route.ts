import { apiError } from "@/lib/api";
import { getRunDiff } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ data: await getRunDiff(id) });
  } catch (error) {
    return apiError(error, "Could not read the diff.");
  }
}
