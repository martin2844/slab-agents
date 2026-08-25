import { operatorPackRepository } from "@/lib/repositories/operator-pack-repository";
import { apiError, notFound } from "@/lib/api";
import { refreshOperatorPackAcceptance } from "@/lib/packs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]/acceptance/[acceptanceId]">,
) {
  try {
    const { id, acceptanceId } = await ctx.params;
    const acceptance =
      operatorPackRepository.getOperatorPackAcceptance(acceptanceId);
    if (!acceptance || acceptance.packId !== id) {
      throw notFound("Acceptance Run not found.");
    }
    return Response.json({
      data: await refreshOperatorPackAcceptance(acceptanceId),
    });
  } catch (error) {
    return apiError(error);
  }
}
