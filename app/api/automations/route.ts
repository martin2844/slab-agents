import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { apiError, notFound } from "@/lib/api";
import { automationCreateSchema } from "@/lib/api-schemas/automation";
import { assertEmailAutomationTarget } from "@/lib/email-automation-service";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ data: automationRepository.listAutomations() });
}
export async function POST(request: Request) {
  try {
    const input = automationCreateSchema.parse(await request.json());
    if (!agentRepository.getAgent(input.agentId))
      throw notFound("Agent not found");
    if (input.triggerType === "email") {
      await assertEmailAutomationTarget(input.agentId, input.emailAccountId!);
    }
    return Response.json(
      { data: automationRepository.createAutomation(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
