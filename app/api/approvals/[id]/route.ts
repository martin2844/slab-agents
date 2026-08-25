import { z } from "zod";
import { apiError } from "@/lib/api";
import { resolveApprovalAction } from "@/lib/approval-resolution";
const schema = z.object({ decision: z.enum(["approve", "deny"]) });
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/approvals/[id]">,
) {
  try {
    const { id } = await ctx.params,
      { decision } = schema.parse(await request.json());
    return Response.json({ data: await resolveApprovalAction(id, decision) });
  } catch (error) {
    return apiError(error);
  }
}
