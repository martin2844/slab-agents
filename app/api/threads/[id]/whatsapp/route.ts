import { apiError, notFound } from "@/lib/api";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!conversationRepository.getThread(id))
      throw notFound("Conversation not found.");
    return Response.json({
      data: whatsappAutomationRepository.getChatStatusForThread(id),
    });
  } catch (error) {
    return apiError(error);
  }
}
