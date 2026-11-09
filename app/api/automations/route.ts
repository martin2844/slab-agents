import { agentRepository } from "@/lib/repositories/agent-repository";
import {
  automationRepository,
  assertWhatsAppRouting,
} from "@/lib/repositories/automation-repository";
import { ensureWhatsAppWebhook } from "@/lib/integrations/whatsapp";
import { automationExecutionRepository } from "@/lib/repositories/automation-execution-repository";
import { apiError, notFound } from "@/lib/api";
import { automationCreateSchema } from "@/lib/api-schemas/automation";
import { assertEmailAutomationTarget } from "@/lib/email-automation-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("activity") === "1") {
    return Response.json({
      data: {
        automations: automationRepository.listAutomations(),
        executions: automationExecutionRepository.listRecentWithSteps(),
      },
    });
  }
  return Response.json({ data: automationRepository.listAutomations() });
}
export async function POST(request: Request) {
  try {
    const input = automationCreateSchema.parse(await request.json());
    if (!agentRepository.getAgent(input.agentId))
      throw notFound("Agent not found");
    const lifecycleStatus =
      input.lifecycleStatus ?? (input.enabled ? "enabled" : "paused");
    if (input.triggerType === "whatsapp" && lifecycleStatus === "enabled") {
      assertWhatsAppRouting("", input.agentId, input.whatsapp, true);
      await ensureWhatsAppWebhook(input.whatsapp!.account);
    }
    if (input.triggerType === "email" && lifecycleStatus === "enabled") {
      await assertEmailAutomationTarget(
        input.agentId,
        input.emailAccountId!,
        input.steps,
      );
    }
    return Response.json(
      { data: automationRepository.createAutomation(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
