import { apiError } from "@/lib/api";
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
      return Response.json(
        { error: "Operator Pack not found." },
        { status: 404 },
      );
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
