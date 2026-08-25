import { apiError, notFound } from "@/lib/api";
import { repository } from "@/lib/repository";
import { automationCreateSchema } from "@/lib/api-schemas/automation";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ data: repository.listAutomations() });
}
export async function POST(request: Request) {
  try {
    const input = automationCreateSchema.parse(await request.json());
    if (!repository.getAgent(input.agentId)) throw notFound("Agent not found");
    return Response.json(
      { data: repository.createAutomation(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
