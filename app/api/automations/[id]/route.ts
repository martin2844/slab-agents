import { z } from "zod";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";
const schema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(2).optional(),
  cronExpression: z.string().nullable().optional(),
  prompt: z.string().min(2).optional(),
  mode: z.enum(["review", "task"]).optional(),
});
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/automations/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const result = repository.updateAutomation(
      id,
      schema.parse(await request.json()),
    );
    if (!result) throw new Error("Automation not found");
    return Response.json({ data: result });
  } catch (error) {
    return apiError(error);
  }
}
