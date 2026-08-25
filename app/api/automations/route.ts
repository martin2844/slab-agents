import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { apiError, notFound } from "@/lib/api";
import { automationCreateSchema } from "@/lib/api-schemas/automation";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ data: automationRepository.listAutomations() });
}
export async function POST(request: Request) {
  try {
    const input = automationCreateSchema.parse(await request.json());
    if (!agentRepository.getAgent(input.agentId))
      throw notFound("Agent not found");
    return Response.json(
      { data: automationRepository.createAutomation(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
