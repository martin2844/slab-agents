import { automationRepository } from "@/lib/repositories/automation-repository";
import { apiError, notFound } from "@/lib/api";
import { automationUpdateSchema } from "@/lib/api-schemas/automation";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/automations/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const result = automationRepository.updateAutomation(
      id,
      automationUpdateSchema.parse(await request.json()),
    );
    if (!result) throw notFound("Automation not found");
    return Response.json({ data: result });
  } catch (error) {
    return apiError(error);
  }
}
