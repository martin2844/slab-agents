import { apiError } from "@/lib/api";
import { disableOperatorPack } from "@/lib/packs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]/disable">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await disableOperatorPack(id) });
  } catch (error) {
    return apiError(error);
  }
}
