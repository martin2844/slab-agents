import { automationRepository } from "@/lib/repositories/automation-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { apiError, notFound } from "@/lib/api";
import { automationUpdateSchema } from "@/lib/api-schemas/automation";
import { assertEmailAutomationTarget } from "@/lib/email-automation-service";
import { assertAutomationTriggerConfiguration } from "@/lib/automation-trigger";
import { OperationalError } from "@/lib/operational-error";
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/automations/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const input = automationUpdateSchema.parse(await request.json());
    const current = automationRepository.getAutomation(id);
    if (!current) throw notFound("Automation not found");
    if (
      input.expectedWorkflowVersion !== undefined &&
      input.expectedWorkflowVersion !== current.workflowVersion
    ) {
      throw new OperationalError(
        "Workflow changed while you were editing. Reload the latest version before saving again.",
        "AUTOMATION_VERSION_CONFLICT",
        409,
      );
    }
    const agentId = input.agentId ?? current.agentId;
    if (!agentRepository.getAgent(agentId)) throw notFound("Agent not found");
    const emailAccountId =
      input.emailAccountId === undefined
        ? current.emailAccountId
        : input.emailAccountId;
    assertAutomationTriggerConfiguration({
      triggerType: current.triggerType,
      cronExpression:
        input.cronExpression === undefined
          ? current.cronExpression
          : input.cronExpression,
      emailAccountId,
      emailMatch: input.emailMatch,
      steps: input.steps,
    });
    if (
      current.triggerType === "email" &&
      emailAccountId &&
      (input.lifecycleStatus ??
        (input.enabled === undefined
          ? current.lifecycleStatus
          : input.enabled
            ? "enabled"
            : "paused")) === "enabled"
    ) {
      await assertEmailAutomationTarget(
        agentId,
        emailAccountId,
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
