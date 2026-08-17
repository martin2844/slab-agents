import { z } from "zod";
import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
import { tickWorkCoordination } from "@/lib/work-coordination";
const schema = z.object({
  author: z.string().min(1).default("Martin"),
  body: z.string().min(1),
});
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/work/issues/[key]/comments">,
) {
  try {
    const { key } = await ctx.params,
      { author, body } = schema.parse(await request.json());
    const comment = await WorkClient.addComment(key, author, body);
    void tickWorkCoordination();
    return Response.json({ data: comment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
