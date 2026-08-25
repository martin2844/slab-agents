import { apiError, notFound } from "@/lib/api";
import {
  previewOperatorPack,
  removeLocalOperatorPackDefinition,
} from "@/lib/packs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await previewOperatorPack(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]">,
) {
  try {
    const { id } = await ctx.params;
    if (!(await removeLocalOperatorPackDefinition(id))) {
      throw notFound("Operator Pack not found.");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
