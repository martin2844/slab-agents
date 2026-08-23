import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  refreshOperatorPackAcceptance,
  startOperatorPackAcceptance,
} from "@/lib/packs/service";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ scenarioId: z.string().min(2).optional() });

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]/acceptance">,
) {
  try {
    const { id } = await ctx.params;
    const data = await Promise.all(
      repository
        .listOperatorPackAcceptances(id)
        .map((acceptance) => refreshOperatorPackAcceptance(acceptance.id)),
    );
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/packs/[id]/acceptance">,
) {
  try {
    const [{ id }, input] = await Promise.all([
      ctx.params,
      request.json().then((value) => schema.parse(value)),
    ]);
    return Response.json(
      { data: await startOperatorPackAcceptance(id, input.scenarioId) },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
