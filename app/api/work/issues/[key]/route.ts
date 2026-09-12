import { z } from "zod";
import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { tickWorkCoordination } from "@/lib/work-coordination";
const updateSchema = z.object({
  expected_version: z.number().int().positive(),
  title: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  status: z
    .enum(["new", "in_progress", "blocked", "review", "done"])
    .optional(),
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
    const approvals = approvalRepository.listPendingForIssue(issue.key);
    return Response.json({ data: { issue, comments, links, approvals } });
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
    const issue = await WorkClient.updateIssue(
      key,
      updateSchema.parse(await request.json()),
    );
    void tickWorkCoordination();
    return Response.json({ data: issue });
  } catch (error) {
    return apiError(error);
  }
}
