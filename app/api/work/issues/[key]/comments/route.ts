import { z } from "zod";
import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
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
    return Response.json(
      { data: await WorkClient.addComment(key, author, body) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
