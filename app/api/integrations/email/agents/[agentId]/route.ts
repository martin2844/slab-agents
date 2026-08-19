import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getEmailIntegrationState,
  revokeAgentEmailAccess,
  saveAgentEmailAccess,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  accountIds: z.array(z.string().trim().min(1)).min(1),
  readEnabled: z.boolean(),
  draftEnabled: z.boolean(),
  sendEnabled: z.boolean(),
  sendPolicy: z.enum(["disabled", "approval_required", "autonomous"]),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    return Response.json({
      data: await saveAgentEmailAccess({
        agentId,
        ...schema.parse(await request.json()),
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    await revokeAgentEmailAccess(agentId);
    return Response.json({ data: await getEmailIntegrationState() });
  } catch (error) {
    return apiError(error);
  }
}
