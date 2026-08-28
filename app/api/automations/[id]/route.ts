import { automationRepository } from "@/lib/repositories/automation-repository";
import { apiError, notFound } from "@/lib/api";
import { automationUpdateSchema } from "@/lib/api-schemas/automation";
import { assertEmailAutomationTarget } from "@/lib/email-automation-service";
import { assertAutomationTriggerConfiguration } from "@/lib/automation-trigger";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/automations/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const input = automationUpdateSchema.parse(await request.json());
    const current = automationRepository.getAutomation(id);
    if (!current) throw notFound("Automation not found");
    assertAutomationTriggerConfiguration({
      triggerType: current.triggerType,
      cronExpression:
        input.cronExpression === undefined
          ? current.cronExpression
          : input.cronExpression,
      emailAccountId: current.emailAccountId,
      emailMatch: input.emailMatch,
      steps: input.steps,
    });
    if (
      current.triggerType === "email" &&
      current.emailAccountId &&
      (input.enabled ?? current.enabled)
    ) {
      await assertEmailAutomationTarget(
        current.agentId,
        current.emailAccountId,
        input.steps ?? current.steps,
      );
    }
    const result = automationRepository.updateAutomation(id, input);
    if (!result) throw notFound("Automation not found");
    return Response.json({ data: result });
  } catch (error) {
    return apiError(error);
  }
}
