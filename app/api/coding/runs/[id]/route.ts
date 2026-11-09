import { apiError, notFound } from "@/lib/api";
import { cancelCodingRun, getCodingRunDetail } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const detail = getCodingRunDetail(id);
  if (!detail) return apiError(notFound("Coding run not found."));
  return Response.json({ data: detail });
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json({ data: await cancelCodingRun(id) });
  } catch (error) {
    return apiError(error, "Could not cancel the coding run.");
  }
}
