import { apiError } from "@/lib/api";
import { exportOperatorPack } from "@/lib/packs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/packs/[id]/export">,
) {
  try {
    const { id } = await ctx.params;
    return new Response(
      `${JSON.stringify(exportOperatorPack(id), null, 2)}\n`,
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.operator-pack.json"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
