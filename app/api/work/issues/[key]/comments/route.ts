import { z } from "zod";
import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
import { tickWorkCoordination } from "@/lib/work-coordination";
import { getSetting } from "@/lib/settings";
const schema = z.object({
  body: z.string().min(1),
});
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/work/issues/[key]/comments">,
) {
  try {
    const { key } = await ctx.params,
      { body } = schema.parse(await request.json());
    const comment = await WorkClient.addComment(
      key,
      getSetting("operator_display_name"),
      body,
    );
    void tickWorkCoordination();
    return Response.json({ data: comment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
