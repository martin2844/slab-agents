import { apiError } from "@/lib/api";
import { refreshOperatorPackAcceptance } from "@/lib/packs/service";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]/acceptance/[acceptanceId]">,
) {
  try {
    const { id, acceptanceId } = await ctx.params;
    const acceptance = repository.getOperatorPackAcceptance(acceptanceId);
    if (!acceptance || acceptance.packId !== id) {
      return Response.json(
        { error: "Acceptance Run not found." },
        { status: 404 },
      );
    }
    return Response.json({
      data: await refreshOperatorPackAcceptance(acceptanceId),
    });
  } catch (error) {
    return apiError(error);
  }
}
