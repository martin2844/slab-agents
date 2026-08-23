import { z } from "zod";
import { apiError } from "@/lib/api";
import { installOperatorPack } from "@/lib/packs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  conflictStrategy: z.enum(["preserve", "replace"]).default("preserve"),
});

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/packs/[id]/install">,
) {
  try {
    const [{ id }, input] = await Promise.all([
      ctx.params,
      request.json().then((value) => schema.parse(value)),
    ]);
    return Response.json({
      data: await installOperatorPack(id, input.conflictStrategy),
    });
  } catch (error) {
    return apiError(error);
  }
}
