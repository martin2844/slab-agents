import { z } from "zod";
import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
const updateSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["new", "in_progress", "done"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  type: z.enum(["epic", "story", "task", "bug"]).optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
});
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/work/issues/[key]">,
) {
  try {
    const { key } = await ctx.params;
    const [issue, comments, links] = await Promise.all([
      WorkClient.getIssue(key),
      WorkClient.listComments(key),
      WorkClient.listLinks(key),
    ]);
    return Response.json({ data: { issue, comments, links } });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/work/issues/[key]">,
) {
  try {
    const { key } = await ctx.params;
    return Response.json({
      data: await WorkClient.updateIssue(
        key,
        updateSchema.parse(await request.json()),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
