import { apiError } from "@/lib/api";
import { openWorkChat } from "@/lib/work-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opens (or reuses) the conversation with the agent assigned to the Work item. */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/work/issues/[key]/chat">,
) {
  try {
    const { key } = await ctx.params;
    return Response.json({ data: await openWorkChat(key) });
  } catch (error) {
    return apiError(error);
  }
}
